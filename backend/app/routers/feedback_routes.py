from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.models.feedback_model import Feedback
from app.models.user_model import Employee

router = APIRouter(tags=["Feedback"])

class FeedbackSubmitRequest(BaseModel):
    employee_id: str
    jd_session_id: Optional[UUID] = None
    category: str
    rating: Optional[int] = None
    message: str

class FeedbackStatusUpdateRequest(BaseModel):
    status: str

@router.post("/feedback")
async def submit_feedback(request: FeedbackSubmitRequest, db: AsyncSession = Depends(get_db)):
    try:
        new_feedback = Feedback(
            employee_id=request.employee_id,
            jd_session_id=request.jd_session_id,
            category=request.category,
            rating=request.rating,
            message=request.message,
            status="unread"
        )
        db.add(new_feedback)
        await db.commit()
        await db.refresh(new_feedback)
        return {"status": "success", "message": "Feedback submitted successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to submit feedback: {str(e)}")


@router.get("/admin/feedback")
async def get_all_feedback(db: AsyncSession = Depends(get_db)):
    try:
        query = select(Feedback).options(
            # Need to get employee details. Note: SQLAlchemy relationship might not be defined if we just have a foreign key.
            # We'll do an explicit join or load depending on Employee model config.
        ).order_by(desc(Feedback.created_at))
        
        # Doing manual outerjoin since relationship might not exist on Feedback model
        query = select(Feedback, Employee).outerjoin(
            Employee, Feedback.employee_id == Employee.id
        ).order_by(desc(Feedback.created_at))

        result = await db.execute(query)
        rows = result.all()
        
        formatted_list = []
        for feedback, employee in rows:
            formatted_list.append({
                "id": str(feedback.id),
                "employee_id": feedback.employee_id,
                "jd_session_id": str(feedback.jd_session_id) if feedback.jd_session_id else None,
                "user_name": employee.name if employee else "Unknown User",
                "user_role": employee.role if employee else "Unknown Role",
                "user_department": employee.department if employee else "Unknown Dept",
                "category": feedback.category,
                "rating": feedback.rating,
                "message": feedback.message,
                "status": feedback.status,
                "created_at": feedback.created_at.isoformat() if feedback.created_at else None
            })
            
        return formatted_list
    except Exception as e:
        print(f"Error fetching feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/admin/feedback/{feedback_id}/status")
async def update_feedback_status(
    feedback_id: UUID, 
    request: FeedbackStatusUpdateRequest, 
    db: AsyncSession = Depends(get_db)
):
    valid_statuses = ["unread", "reviewed", "resolved"]
    if request.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
        
    try:
        result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
        feedback = result.scalar_one_or_none()
        
        if not feedback:
            raise HTTPException(status_code=404, detail="Feedback not found")
            
        feedback.status = request.status
        await db.commit()
        
        return {"status": "success", "message": f"Feedback status updated to {request.status}"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
