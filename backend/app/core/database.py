# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings
from typing import AsyncGenerator
import logging

logger = logging.getLogger(__name__)

# Configure SSL for asyncpg
connect_args = {
    "server_settings": {"jit": "off"},  # Disable JIT for short queries
    "command_timeout": 60,
}

# Handle SSL configuration for asyncpg
if settings.DATABASE_SSL and settings.DATABASE_SSL != "disable":
    if settings.DATABASE_SSL == "require":
        # For development, we'll disable SSL verification
        # In production, you should configure proper SSL certificates
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ssl_context

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,  # 5 per worker × 2 workers = 10 total (was 10×2=20, too many for Aiven free)
    max_overflow=5,  # Allow burst to 10 per worker max
    pool_recycle=1800,  # Recycle every 30 min (not 1 hour — Aiven kills idle at 5min)
    pool_timeout=30,  # Wait max 30s for a connection
    connect_args=connect_args,
)

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
        async with engine.begin() as conn:


            # Add trigger function for updated_at — Using a DO block to make it safer for concurrent workers
            # Ensure timestamp columns for RBAC workflow exist
            await conn.execute(text("ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS sent_to_manager_at TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS sent_to_hr_at TIMESTAMP WITH TIME ZONE"))
            await conn.execute(
                text("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
                        CREATE FUNCTION touch_updated_at()
                        RETURNS TRIGGER AS $inner$
                        BEGIN NEW.updated_at = now(); RETURN NEW; END;
                        $inner$ LANGUAGE plpgsql;
                    END IF;
                END
                $$;
            """)
            )

            # Add trigger specifically to jd_sessions
            await conn.execute(
                text("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_trigger 
                        WHERE tgname = 'trg_jd_sessions_updated'
                    ) THEN
                        CREATE TRIGGER trg_jd_sessions_updated
                        BEFORE UPDATE ON jd_sessions
                        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
                    END IF;
                END
                $$;
            """)
            )

            # Bootstrap compatibility for fields that newer code requires.
            await conn.execute(
                text("""
                ALTER TABLE jd_sessions
                ADD COLUMN IF NOT EXISTS source_reference_jd_id VARCHAR(36);
            """)
            )
            await conn.execute(
                text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_jd_sessions_source_reference_jd_id
                ON jd_sessions (source_reference_jd_id)
                WHERE source_reference_jd_id IS NOT NULL;
            """)
            )
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
