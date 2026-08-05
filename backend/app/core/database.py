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
        "timeout": 30,  # 30s connection timeout for TLS/TCP establishment
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
        pool_size=5,       # 5 per worker — prevents hitting Aiven max_connections limit
        max_overflow=2,     # Burst to 7 per worker max
        pool_recycle=180,   # Recycle every 3 min — frees idle Aiven connections quickly
        pool_timeout=15,    # Wait max 15s for a connection
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

                    -- Unique constraint: prevent duplicate KRA/KPI sessions per employee per JD
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'uq_krakpi_jd_employee'
                    ) THEN
                        BEGIN
                            ALTER TABLE kra_kpi_sessions
                            ADD CONSTRAINT uq_krakpi_jd_employee UNIQUE (jd_session_id, employee_id);
                        EXCEPTION WHEN duplicate_table THEN
                            NULL;
                        END;
                    END IF;

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

                    -- function & trigger: bi-directional sync (jd_sessions -> reference_jds)
                    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_jd_session_to_reference') THEN
                        CREATE FUNCTION sync_jd_session_to_reference()
                        RETURNS TRIGGER AS $inner$
                        DECLARE
                            v_emp_name VARCHAR(100);
                            v_level VARCHAR(50);
                            v_ref_id VARCHAR(36);
                        BEGIN
                            IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
                            IF NEW.employee_id IS NULL OR NEW.jd_structured IS NULL OR NEW.jd_structured = '{}'::jsonb THEN RETURN NEW; END IF;

                            SELECT employee_name INTO v_emp_name FROM organogram WHERE code = NEW.employee_id LIMIT 1;
                            IF v_emp_name IS NULL THEN v_emp_name := 'Employee'; END IF;

                            v_level := COALESCE(NEW.jd_structured->>'job_level', NEW.jd_structured->>'level', NEW.jd_structured->>'joblevel', 'Level 1');

                            SELECT id INTO v_ref_id FROM reference_jds WHERE employee_id = NEW.employee_id ORDER BY uploaded_at DESC LIMIT 1;

                            IF v_ref_id IS NOT NULL THEN
                                UPDATE reference_jds
                                SET structured_data = NEW.jd_structured,
                                    role_title = COALESCE(NEW.title, role_title),
                                    department = COALESCE(NEW.department, department),
                                    employee_name = COALESCE(v_emp_name, employee_name),
                                    level = COALESCE(v_level, level),
                                    uploaded_at = NOW()
                                WHERE id = v_ref_id;
                                
                                IF NOT EXISTS (SELECT 1 FROM jd_sessions WHERE source_reference_jd_id = v_ref_id AND id <> NEW.id) THEN
                                    NEW.source_reference_jd_id := v_ref_id;
                                END IF;
                            ELSE
                                v_ref_id := gen_random_uuid()::text;
                                INSERT INTO reference_jds (
                                    id, employee_id, employee_name, department, role_title, level,
                                    structured_data, processing_status, uploaded_at, is_active, version
                                ) VALUES (
                                    v_ref_id, NEW.employee_id, v_emp_name, COALESCE(NEW.department, 'General'),
                                    COALESCE(NEW.title, 'Approved Role JD'), v_level,
                                    NEW.jd_structured, 'published', NOW(), true, 1
                                );
                                NEW.source_reference_jd_id := v_ref_id;
                            END IF;
                            RETURN NEW;
                        END;
                        $inner$ LANGUAGE plpgsql;
                    END IF;

                    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_jd_session_to_ref') THEN
                        CREATE TRIGGER trg_sync_jd_session_to_ref
                        BEFORE INSERT OR UPDATE ON jd_sessions
                        FOR EACH ROW EXECUTE FUNCTION sync_jd_session_to_reference();
                    END IF;

                    -- function & trigger: bi-directional sync (reference_jds -> jd_sessions)
                    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_reference_to_jd_session') THEN
                        CREATE FUNCTION sync_reference_to_jd_session()
                        RETURNS TRIGGER AS $inner$
                        DECLARE
                            v_session_id UUID;
                        BEGIN
                            IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
                            IF NEW.employee_id IS NULL OR NEW.structured_data IS NULL OR NEW.structured_data = '{}'::jsonb THEN RETURN NEW; END IF;

                            SELECT id INTO v_session_id FROM jd_sessions WHERE employee_id = NEW.employee_id ORDER BY updated_at DESC LIMIT 1;
                            IF v_session_id IS NOT NULL THEN
                                UPDATE jd_sessions
                                SET jd_structured = NEW.structured_data,
                                    source_reference_jd_id = NEW.id,
                                    updated_at = NOW()
                                WHERE id = v_session_id;
                            END IF;
                            RETURN NEW;
                        END;
                        $inner$ LANGUAGE plpgsql;
                    END IF;

                    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_ref_to_jd_session') THEN
                        CREATE TRIGGER trg_sync_ref_to_jd_session
                        AFTER UPDATE ON reference_jds
                        FOR EACH ROW EXECUTE FUNCTION sync_reference_to_jd_session();
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
