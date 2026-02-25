from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.models.user_model import Employee

router = APIRouter()

class SSOSyncRequest(BaseModel):
    employee_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None

@router.post("/sso-sync")
async def sso_sync(request: SSOSyncRequest, db: AsyncSession = Depends(get_db)):
    """
    Simulates an SSO callback saving user info to the database.
    In a real scenario, the IdP sends a token, we decode it, and then sync here.
    """
    result = await db.execute(select(Employee).filter(Employee.id == request.employee_id))
    user = result.scalars().first()

    if user:
        # Update existing user
        if request.name: user.name = request.name
        if request.email: user.email = request.email
        if request.department: user.department = request.department
    else:
        # Create new user
        user = Employee(
            id=request.employee_id,
            name=request.name or "Unknown Employee",
            email=request.email,
            department=request.department
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    return {
        "status": "success",
        "user": {
            "employee_id": user.id,
            "name": user.name,
            "email": user.email,
            "department": user.department
        }
    }

