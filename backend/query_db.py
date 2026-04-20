import asyncio
from app.db.session import async_session
from app.models.jd_model import JDSession, ConversationTurn
from sqlalchemy import select
from sqlalchemy.orm import selectinload

async def main():
    async with async_session() as db:
        res = await db.execute(select(JDSession).where(JDSession.employee_id == "C0014").order_by(JDSession.created_at.desc()))
        record = res.scalars().first()
        if not record:
            print("No record found")
            return
        print(f"ID: {record.id}")
        print(f"Status: {record.status}")
        res2 = await db.execute(select(ConversationTurn).where(ConversationTurn.session_id == record.id))
        turns = res2.scalars().all()
        print(f"Turns count: {len(turns)}")

asyncio.run(main())
