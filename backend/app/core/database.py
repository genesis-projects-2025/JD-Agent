# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings
from typing import AsyncGenerator

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,  # Increase pool size per worker
    max_overflow=20,  # Allow more temporary connections
    pool_recycle=3600,  # Recycle connections hourly
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
    """Create all tables on startup if they don't exist, and setup triggers."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

            # Add trigger function for updated_at — Using a DO block to make it safer for concurrent workers
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
        print("✅ Database tables and triggers ready")
    except Exception as e:
        # If another worker is already updating the metadata/triggers, we can skip
        if "tuple concurrently updated" in str(e) or "already exists" in str(e).lower():
            print("ℹ️ Database initialization skip: Concurrent update or already exists.")
        else:
            print(f"❌ Database initialization error: {e}")
            raise
