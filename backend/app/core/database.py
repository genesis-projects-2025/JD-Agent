# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings
from typing import AsyncGenerator
import logging

logger = logging.getLogger(__name__)

_is_postgres = settings.DATABASE_URL.startswith("postgresql")

# asyncpg-specific connect args — only relevant for PostgreSQL
connect_args: dict = {}
if _is_postgres:
    connect_args = {
        "server_settings": {"jit": "off"},  # Disable JIT for short queries
        "command_timeout": 60,
    }
    # SSL configuration for asyncpg (Aiven requires SSL)
    if settings.DATABASE_SSL and settings.DATABASE_SSL != "disable":
        if settings.DATABASE_SSL == "require":
            import ssl
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            connect_args["ssl"] = ssl_context

_engine_kwargs: dict = dict(
    echo=False,
    pool_pre_ping=True,
    connect_args=connect_args,
)
if _is_postgres:
    _engine_kwargs.update(
        pool_size=3,        # 3 per worker — keeps total well under Aiven free tier limit
        max_overflow=2,     # Burst to 5 per worker max
        pool_recycle=300,   # Recycle every 5 min — matches Aiven idle timeout
        pool_timeout=30,    # Wait max 30s for a connection
    )

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


from sqlalchemy import text  # noqa: E402


async def init_db():
    """Create core tables and lightweight compatibility objects on startup."""
    try:
        # Use a SINGLE connection for all startup DDL to avoid per-connect RTT overhead.
        # Each engine.begin() on Aiven costs ~2-3s for pool setup — batching saves ~8s.
        async with engine.begin() as conn:
            # Set a hard lock_timeout so DDL never hangs longer than 20 s
            if conn.dialect.name == "postgresql":
                await conn.execute(text("SET LOCAL lock_timeout = '20s'"))

            # --- Kill stale idle connections that may hold table locks ---
            # Zombie connections from crashed workers can block ALTER TABLE indefinitely.
            if conn.dialect.name == "postgresql":
                try:
                    await conn.execute(text("""
                        SELECT pg_terminate_backend(pid)
                        FROM pg_stat_activity
                        WHERE pid <> pg_backend_pid()
                          AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')
                          AND query_start < now() - interval '2 minutes'
                    """))
                    logger.info("🧹 Stale idle DB connections terminated before DDL")
                except Exception as _ce:
                    logger.warning(f"Could not clean stale connections (non-fatal): {_ce}")

            # Enable pgvector if on PostgreSQL
            if conn.dialect.name == "postgresql":
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

            # --- Fast-path: skip create_all if tables already exist ---
            # Base.metadata.create_all does per-table catalog round-trips (~23s on Aiven).
            # Instead, check existence with ONE query; only run create_all on first deploy.
            tables_exist = False
            if conn.dialect.name == "postgresql":
                result = await conn.execute(text(
                    "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='jd_sessions')"
                ))
                tables_exist = result.scalar()

            if not tables_exist:
                logger.info("🏗️  First deploy detected — running create_all to build schema...")
                await conn.run_sync(Base.metadata.create_all)
                logger.info("✅ Schema created")
            else:
                logger.info("⚡ Tables already exist — skipping create_all (fast path)")

            # If using SQLite (e.g. for local testing/development), return early
            # since SQLite does not support PostgreSQL-specific DDL and PL/pgSQL syntax.
            if conn.dialect.name == "sqlite":
                for col, col_type in [
                    ("reviewer_comment", "TEXT"),
                    ("reviewed_by", "VARCHAR(255)"),
                    ("reviewed_at", "TIMESTAMP"),
                    ("skill_ratings", "TEXT"),
                    ("improvement_area", "TEXT"),
                    ("improvement_goal", "TEXT"),
                    ("improvement_status", "VARCHAR(50)"),
                ]:
                    try:
                        await conn.execute(text(f"ALTER TABLE kra_kpi_sessions ADD COLUMN {col} {col_type}"))
                    except Exception:
                        pass
                logger.info("ℹ️ SQLite database detected. Skipping PostgreSQL-specific database migrations.")
                return

            # --- Single-batch DDL: all ALTERs + triggers + index in ONE round-trip ---
            # Previously 13 separate awaits × ~1.2s Aiven RTT = ~15s. Now 1 round-trip.
            await conn.execute(text("""
                DO $$
                BEGIN
                    -- jd_sessions columns
                    ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS sent_to_manager_at TIMESTAMP WITH TIME ZONE;
                    ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS sent_to_hr_at TIMESTAMP WITH TIME ZONE;
                    ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS source_reference_jd_id VARCHAR(36);

                    -- kra_kpi_sessions columns
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS reviewer_comment TEXT;
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255);
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS skill_ratings JSONB;
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS improvement_area TEXT;
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS improvement_goal TEXT;
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS improvement_status VARCHAR(50);
                    ALTER TABLE kra_kpi_sessions ADD COLUMN IF NOT EXISTS conversation_state JSONB;

                    -- touch_updated_at trigger function
                    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
                        CREATE FUNCTION touch_updated_at()
                        RETURNS TRIGGER AS $inner$
                        BEGIN NEW.updated_at = now(); RETURN NEW; END;
                        $inner$ LANGUAGE plpgsql;
                    END IF;

                    -- trigger: jd_sessions
                    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_jd_sessions_updated') THEN
                        CREATE TRIGGER trg_jd_sessions_updated
                        BEFORE UPDATE ON jd_sessions
                        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
                    END IF;

                    -- trigger: brain_agent_sessions
                    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_brain_agent_sessions_updated') THEN
                        CREATE TRIGGER trg_brain_agent_sessions_updated
                        BEFORE UPDATE ON brain_agent_sessions
                        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
                    END IF;
                END
                $$;
            """))

            # CREATE INDEX must be outside DO $$ (DDL index creation not allowed inside PL/pgSQL)
            await conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_jd_sessions_source_reference_jd_id
                ON jd_sessions (source_reference_jd_id)
                WHERE source_reference_jd_id IS NOT NULL;
            """))
        logger.info("✅ Database tables and triggers ready")
    except Exception as e:
        # If another worker is already updating the metadata/triggers, we can skip
        if "tuple concurrently updated" in str(e) or "already exists" in str(e).lower():
            logger.info(
                "ℹ️ Database initialization skip: Concurrent update or already exists."
            )
        else:
            logger.error(f"❌ Database initialization error: {e}")
            raise

from sqlalchemy.types import TypeDecorator, UserDefinedType, JSON

class PGVector(UserDefinedType):
    def __init__(self, dim=3072):
        self.dim = dim
    def get_col_spec(self, **kw):
        return f"VECTOR({self.dim})"

class SafeVector(TypeDecorator):
    impl = JSON
    cache_ok = True

    def __init__(self, dim=3072):
        super().__init__()
        self.dim = dim

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PGVector(self.dim))
        return dialect.type_descriptor(JSON)

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            if isinstance(value, list):
                return "[" + ",".join(map(str, value)) + "]"
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql" and isinstance(value, str):
            val_str = value.strip("[]")
            if not val_str:
                return []
            return [float(x) for x in val_str.split(",")]
        return value
