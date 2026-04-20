from fastapi import Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.core.database import get_db
from app.models.user_model import Employee

async def get_current_user(
    x_employee_id: Optional[str] = Header(None, alias="X-Employee-ID"),
    emp_code: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
) -> Employee:
    """
    Simulation of an authentication layer.
    In a real app, this would verify a JWT.
    Here, it trusts the X-Employee-ID header (or emp_code query param for compatibility).
    """
    user_id = x_employee_id or emp_code
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    result = await db.execute(select(Employee).where(Employee.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user

async def hr_required(user: Employee = Depends(get_current_user)):
    """Ensures the user has HR or Department Head privileges."""
    if user.role not in ["hr", "head", "admin"]:
        raise HTTPException(status_code=403, detail="HR permissions required")
    return user

async def manager_required(user: Employee = Depends(get_current_user)):
    """Ensures the user has Managerial privileges."""
    if user.role not in ["manager", "head", "hr", "admin"]:
        raise HTTPException(status_code=403, detail="Manager permissions required")
    return user
