"""
seed_aiven.py — Migrates all tables + organogram data to Aiven.
Run from: cd backend && source venv/bin/activate && python seed_aiven.py
"""
import asyncio, csv, os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from urllib.parse import quote_plus
from dotenv import load_dotenv

load_dotenv()

def get_url():
    h = os.environ["DATABASE_HOST"]
    p = os.environ["DATABASE_PORT"]
    n = os.environ["DATABASE_NAME"]
    u = os.environ["DATABASE_USER_NAME"]
    pw = quote_plus(os.environ["DATABASE_PASS"])
    ssl = os.environ.get("DATABASE_SSL", "require")
    return f"postgresql+asyncpg://{u}:{pw}@{h}:{p}/{n}?ssl={ssl}"

CREATE_ORGANOGRAM = """
CREATE TABLE IF NOT EXISTS organogram (
    division_               VARCHAR(100),
    division                VARCHAR(100),
    territory               VARCHAR(100),
    hq                      VARCHAR(100),
    region                  VARCHAR(100),
    "Zone"                  VARCHAR(100),
    emp_code                VARCHAR(50),
    emp_name                VARCHAR(100),
    gender                  VARCHAR(10),
    reporting_manager       VARCHAR(100),
    area_name               VARCHAR(100),
    reporting_manager_code  VARCHAR(50),
    joining_date            VARCHAR(50),
    "Role"                  VARCHAR(50),
    phone_mobile            BIGINT,
    email1                  VARCHAR(100),
    status                  VARCHAR(50),
    lastdcrdate             VARCHAR(50),
    dob                     VARCHAR(50),
    terr_joining_date       VARCHAR(50)
);
"""

def load_rows():
    path = Path(__file__).parent / "organogram_export.csv"
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ph = row.get("phone_mobile","").strip()
            row["phone_mobile"] = int(ph) if ph else None
            rows.append(row)
    return rows

async def main():
    url = get_url()
    print(f"🔗 Connecting to Aiven: {url.split('@')[1]}")
    engine = create_async_engine(url, echo=False, pool_pre_ping=True,
                                  connect_args={"command_timeout": 60})

    # ── Phase 1: Organogram table + bulk insert ──────────────────────────────
    rows = load_rows()
    print(f"📄 Loaded {len(rows)} organogram rows from CSV")

    cols = ["division_","division","territory","hq","region","Zone","emp_code",
            "emp_name","gender","reporting_manager","area_name",
            "reporting_manager_code","joining_date","Role","phone_mobile",
            "email1","status","lastdcrdate","dob","terr_joining_date"]

    quoted_cols = ', '.join(f'"{c}"' if c in ("Zone","Role") else c for c in cols)
    param_placeholders = ', '.join(f":{c}" for c in cols)
    INSERT = f"INSERT INTO organogram ({quoted_cols}) VALUES ({param_placeholders})"

    async with engine.begin() as conn:
        await conn.execute(text(CREATE_ORGANOGRAM))
        print("✅ organogram table ready")
        count = (await conn.execute(text("SELECT COUNT(*) FROM organogram"))).scalar()
        if count > 0:
            print(f"⚠️  organogram already has {count} rows — skipping insert.")
            print("   To re-seed run: psql -c 'TRUNCATE organogram;' then rerun.")
        else:
            # Bulk insert in batches of 100
            batch_size = 100
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i+batch_size]
                for row in batch:
                    await conn.execute(text(INSERT), row)
                print(f"   ↳ Inserted rows {i+1}–{min(i+batch_size, len(rows))}")
            print(f"✅ Inserted all {len(rows)} rows into organogram")

    # ── Phase 2: ORM Tables ──────────────────────────────────────────────────
    print("\n🏗️  Creating ORM tables...")
    from app.core.database import Base
    import app.models.user_model        # noqa
    import app.models.jd_session_model  # noqa
    import app.models.taxonomy_model    # noqa
    import app.models.feedback_model    # noqa

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        print("✅ employees, jd_sessions, conversation_turns, jd_versions,")
        print("   skills, jd_session_skills, employee_skills, feedbacks — all created")

        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION touch_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = now(); RETURN NEW; END;
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_jd_sessions_updated'
                ) THEN
                    CREATE TRIGGER trg_jd_sessions_updated
                    BEFORE UPDATE ON jd_sessions
                    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
                END IF;
            END $$;
        """))
        print("✅ updated_at trigger created")

    await engine.dispose()
    print("\n🎉 All done! Aiven DB is fully set up.")

if __name__ == "__main__":
    asyncio.run(main())
