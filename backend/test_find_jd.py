import traceback
import asyncio
import os
import sys

# Ensure backend directory is in the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.session import async_session_maker
from app.models.jd_model import JD
from sqlalchemy import select

async def main():
    async with async_session_maker() as session:
        result = await session.execute(select(JD).order_by(JD.created_at.desc()).limit(1))
        jd = result.scalar_one_or_none()
        if jd:
            print("Successfully connected to the database!")
            print('Generated JD length: ', len(jd.generated_jd) if jd.generated_jd else 0)
            print('Structured Data Type: ', type(jd.structured_data))
            if isinstance(jd.structured_data, dict):
                print('Structured Data Keys:', jd.structured_data.keys())
            else:
                print('Structured Data Output: ', jd.structured_data)
        else:
            print("No JD found.")

if __name__ == "__main__":
    asyncio.run(main())
