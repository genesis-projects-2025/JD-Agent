# backend/app/core/auth.py

from fastapi import Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from typing import Optional

from app.core.database import get_db
from app.models.user_model import Employee


async def get_current_user(
    x_employee_id: Optional[str] = Header(None, alias="X-Employee-ID"),
    emp_code: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> Employee:
    user_id = x_employee_id or emp_code
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # 1. Try fetching from employees table
    result = await db.execute(select(Employee).where(Employee.id == user_id))
    user = result.scalar_one_or_none()

    # 2. If user is missing OR role is not set, sync from organogram table
    if not user or not user.role or user.role == "employee":
        org_query = text("""
            SELECT employee_name, designation, department, reporting_manager, reporting_manager_code
            FROM organogram WHERE LOWER(TRIM(code)) = LOWER(TRIM(:code))
        """)
        org_res = await db.execute(org_query, {"code": user_id})
        org_row = org_res.mappings().first()

        if not org_row and not user:
            raise HTTPException(status_code=401, detail="User not found in Organogram")

        # Compute role based on designation
        desig_lower = (org_row.get("designation") or "").lower() if org_row else ""
        computed_role = "employee"

        # Hardcoded HR testing account
        if user_id == "E6679":
            computed_role = "hr"
        elif any(kw in desig_lower for kw in ["hr", "human resource", "admin"]):
            computed_role = "hr"
        elif any(
            kw in desig_lower
            for kw in [
                "manager",
                "head",
                "director",
                "vp",
                "agm",
                "dgm",
                "lead",
                "chief",
                "president",
                "supervisor",
                "officer",
            ]
        ):
            computed_role = "manager"
        else:
            # Check if they have direct reports in organogram
            reports_query = text(
                "SELECT COUNT(1) FROM organogram WHERE reporting_manager_code = :code"
            )
            reports_res = await db.execute(reports_query, {"code": user_id})
            if (reports_res.scalar() or 0) > 0:
                computed_role = "manager"

        # Update existing employee, or create a new one
        if user:
            if user.role != computed_role:
                user.role = computed_role
                if org_row:
                    user.name = org_row.get("employee_name") or user.name
                    user.department = org_row.get("department") or user.department
                    user.reporting_manager = org_row.get("reporting_manager")
                    user.reporting_manager_code = org_row.get("reporting_manager_code")
        elif org_row:
            user = Employee(
                id=user_id,
                name=org_row.get("employee_name") or "Unknown",
                department=org_row.get("department"),
                reporting_manager=org_row.get("reporting_manager"),
                reporting_manager_code=org_row.get("reporting_manager_code"),
                role=computed_role,
            )
            db.add(user)

        await db.commit()
        if user:
            await db.refresh(user)

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


async def hr_required(
    user: Employee = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Ensures the user has HR or Department Head privileges."""
    if user.role in ["hr", "head", "admin"]:
        return user
    raise HTTPException(status_code=403, detail="HR permissions required")


# backend/app/core/auth.py


async def manager_required(
    user: Employee = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Ensures the user has Managerial privileges."""
    # 1. If the role is already correct in the DB, let them in instantly
    if user.role in ["manager", "head", "hr", "admin"]:
        return user

    # 2. Hardcoded override for E6679
    if user.id == "E6679":
        user.role = "hr"
        await db.commit()
        await db.refresh(user)
        return user

    # 3. Check if they have direct reports in the organogram
    from app.services.dashboard_service import DashboardService

    has_reports = await DashboardService.has_direct_reports(db, user.id)
    if has_reports:
        if user.role not in ["manager", "head", "hr", "admin"]:
            user.role = "manager"
            await db.commit()
            await db.refresh(user)
        return user

    # 4. Fallback: Check designation in organogram (AGM, DGM, Manager, etc.)
    manager_keywords = [
        "manager",
        "head",
        "director",
        "vp",
        "vice president",
        "avp",
        "agm",
        "dgm",
        "lead",
        "chief",
        "president",
        "officer",
        "supervisor",
    ]

    org_query = text(
        "SELECT designation FROM organogram WHERE LOWER(TRIM(code)) = LOWER(TRIM(:emp_code))"
    )
    org_res = await db.execute(org_query, {"emp_code": user.id})
    org_row = org_res.mappings().first()

    if org_row:
        desig_lower = (org_row.get("designation") or "").lower()
        if any(kw in desig_lower for kw in manager_keywords):
            user.role = "manager"
            await db.commit()
            await db.refresh(user)
            return user

    raise HTTPException(status_code=403, detail="Manager permissions required")
