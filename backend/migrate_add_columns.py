"""
One-time migration script: adds new columns to the existing 'questionnaires' table.
Run from the backend/ directory:
    python migrate_add_columns.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

ALTER_STATEMENTS = [
    # Display fields (extracted from JSONB at save time)
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255)",
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS role_title VARCHAR(255)",
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS department VARCHAR(255)",
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS completion_percentage FLOAT DEFAULT 0.0",

    # Review fields
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS reviewer_comment TEXT",
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255)",
    "ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP",

    # Fix updated_at to have a default (in case it was created without one)
    # PostgreSQL only — safe to run even if already set
    "ALTER TABLE questionnaires ALTER COLUMN updated_at SET DEFAULT NOW()",
]


async def run():
    engine = create_async_engine(settings.DATABASE_URL, echo=True)
    async with engine.begin() as conn:
        for stmt in ALTER_STATEMENTS:
            print(f"▶ {stmt}")
            await conn.execute(text(stmt))
    print("\n✅ Migration complete — all new columns added.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
