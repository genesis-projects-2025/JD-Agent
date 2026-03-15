import asyncio
import json
from app.core.database import AsyncSessionLocal
from app.models.jd_model import JDQuestionnaire
from sqlalchemy.future import select

async def main():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(JDQuestionnaire).where(JDQuestionnaire.jd_structured != None))
        jd = result.scalars().first()
        if jd:
            print(json.dumps(jd.jd_structured, indent=2))
        else:
            print("No JD found")

asyncio.run(main())
