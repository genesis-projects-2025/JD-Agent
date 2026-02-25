# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings
from typing import AsyncGenerator

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
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


from sqlalchemy import text

async def init_db():
    """Create all tables on startup if they don't exist, and setup triggers."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Add trigger function for updated_at
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION touch_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = now(); RETURN NEW; END;
            $$ LANGUAGE plpgsql;
        """))
        
        # Add trigger specifically to jd_sessions
        # Using DO block to avoid error if trigger already exists
        await conn.execute(text("""
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
        """))
        
    print("✅ Database tables and triggers ready")