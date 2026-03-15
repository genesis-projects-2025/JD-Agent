from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user_model import Employee

router = APIRouter()


class LoginRequest(BaseModel):
    emp_code: str


class HierarchyRequest(BaseModel):
    territory: Optional[str] = None


@router.get("/organogram/employees")
async def get_organogram_employees(db: AsyncSession = Depends(get_db)):
    """
    Fetches all employees from the organogram to populate the login search list.
    """
    query = text("""
        SELECT code as emp_code, employee_name as emp_name, designation as role, reporting_manager, 
               reporting_manager_code, '' as email, NULL as phone_mobile, department
        FROM organogram
    """)

    result = await db.execute(query)
    rows = result.mappings().all()
    return {"employees": [dict(row) for row in rows]}


@router.post("/sso-sync")
async def login_organogram(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Accepts an emp_code, looks it up in organogram, calculates a hierarchical role
    (employee, manager, or hr) for testing, and upserts into employees table.
    """
    # 1. Fetch the user's organogram row
    user_query = text("""
        SELECT code as emp_code, employee_name as emp_name, reporting_manager, 
               reporting_manager_code, '' as email, NULL as phone_mobile, department
        FROM organogram
        WHERE code = :emp_code
    """)
    user_result = await db.execute(user_query, {"emp_code": request.emp_code})
    row = user_result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Employee not found in organogram")

    # 2. Determine "hierarchy role"
    #   employee: has a manager, but no one reports to them
    #   manager: people report to them, and they have a manager
    #   hr: top of the chain (no reporting manager)

    reporting_code = row.get("reporting_manager_code")
    has_manager = bool(reporting_code and str(reporting_code).strip())

    # Check if anyone reports to this user
    reports_query = text("""
        SELECT COUNT(1) as child_count
        FROM organogram
        WHERE reporting_manager_code = :emp_code
    """)
    reports_res = await db.execute(reports_query, {"emp_code": request.emp_code})
    child_count = reports_res.scalar() or 0
    has_reports = child_count > 0

    if not has_manager:
        computed_role = "hr"
    elif has_reports:
        computed_role = "manager"
    else:
        computed_role = "employee"

    # Hardcode override for HR testing request
    if request.emp_code == "C0014":
        computed_role = "hr"

    # 3. Upsert into employees table
    from sqlalchemy.future import select

    emp_res = await db.execute(select(Employee).where(Employee.id == request.emp_code))
    emp = emp_res.scalar_one_or_none()

    # Safely handle bigint phone mobile to string
    phone_str = str(row.get("phone_mobile", "")) if row.get("phone_mobile") else None

    if emp:
        # Update existing
        emp.name = row["emp_name"] or emp.name
        emp.email = row["email"] or emp.email
        emp.department = row["department"] or emp.department
        emp.reporting_manager = row["reporting_manager"]
        emp.reporting_manager_code = row["reporting_manager_code"]
        emp.role = computed_role
        emp.phone_mobile = phone_str
    else:
        # Insert new
        emp = Employee(
            id=request.emp_code,
            name=row["emp_name"] or "Unknown",
            email=row["email"],
            department=row["department"],
            reporting_manager=row["reporting_manager"],
            reporting_manager_code=row["reporting_manager_code"],
            role=computed_role,
            phone_mobile=phone_str,
        )
        db.add(emp)

    await db.commit()
    await db.refresh(emp)

    return {
        "status": "success",
        "employee": {
            "employee_id": emp.id,
            "name": emp.name,
            "email": emp.email,
            "department": emp.department,
            "reporting_manager": emp.reporting_manager,
            "reporting_manager_code": emp.reporting_manager_code,
            "role": emp.role,
            "phone_mobile": emp.phone_mobile,
        },
    }


@router.get("/me/{emp_code}")
async def get_my_profile(emp_code: str, db: AsyncSession = Depends(get_db)):
    """
    Fetches the synced employee profile from the employees table.
    If the table was recently wiped, it auto-restores their profile from the organogram table seamlessly.
    """
    from sqlalchemy.future import select

    result = await db.execute(select(Employee).where(Employee.id == emp_code))
    emp = result.scalar_one_or_none()

    if not emp:
        # Fallback seamless recovery
        req = LoginRequest(emp_code=emp_code)
        try:
            recovery = await login_organogram(req, db)
            return recovery["employee"]
        except HTTPException:
            raise HTTPException(
                status_code=404, detail="Employee profile not found in directory"
            )

    return {
        "employee_id": emp.id,
        "name": emp.name,
        "email": emp.email,
        "department": emp.department,
        "reporting_manager": emp.reporting_manager,
        "reporting_manager_code": emp.reporting_manager_code,
        "role": emp.role,
        "phone_mobile": emp.phone_mobile,
    }


@router.post("/hierarchy")
async def get_hierarchy(
    request: HierarchyRequest = Body(default=HierarchyRequest()),
    db: AsyncSession = Depends(get_db),
):
    """
    Builds the organizational hierarchy tree based on Territory.
    """
    try:
        territory = request.territory
        query = text("""
            SELECT territory as "Territory", 
                   area_name as "Area_Name", 
                   emp_name as "Emp_Name", 
                   "Role" as "Role"
            FROM organogram
        """)
        result = await db.execute(query)
        rows = result.mappings().all()

        if not rows:
            return {"message": "No data found"}

        # STEP 1: FIND FULL SUBTREE UNDER SELECTED TERRITORY
        def get_all_descendants(start_territory: str) -> set:
            result_set = set()
            queue = [start_territory]

            while queue:
                current = queue.pop(0)
                result_set.add(current)

                children = [
                    r
                    for r in rows
                    if r.get("Area_Name")
                    and r.get("Area_Name").strip().lower() == current.strip().lower()
                ]
                for child in children:
                    queue.append(child.get("Territory"))

            return result_set

        if territory:
            subtree_territories = get_all_descendants(territory)
        else:
            subtree_territories = {r.get("Territory") for r in rows}

        # STEP 2: FILTER ROWS ONLY INSIDE SUBTREE
        filtered_rows = [r for r in rows if r.get("Territory") in subtree_territories]

        # STEP 3: BUILD LOOKUP MAP
        by_territory = {r.get("Territory"): r for r in filtered_rows}

        # STEP 4: BUILD TREE RECURSIVELY
        def build_node(terr: str):
            emp = by_territory.get(terr)
            if not emp:
                return None

            child_rows = [
                r
                for r in filtered_rows
                if r.get("Area_Name")
                and r.get("Area_Name").strip().lower() == terr.strip().lower()
            ]

            children = {}
            for child in child_rows:
                child_node = build_node(child.get("Territory"))
                if child_node:
                    children[child.get("Territory")] = child_node

            return {
                "empName": emp.get("Emp_Name"),
                "territory": emp.get("Territory"),
                "role": emp.get("Role"),
                "children": children,
            }

        # STEP 5: FIND ROOT NODE
        hierarchy = {}

        if territory:
            node = build_node(territory)
            if node:
                hierarchy[territory] = node
        else:
            # If no territory provided, return full forest
            child_areas = set(
                r.get("Area_Name").strip()
                for r in filtered_rows
                if r.get("Area_Name") and r.get("Area_Name").strip()
            )

            top_levels = [
                r
                for r in filtered_rows
                if r.get("Territory", "").strip() not in child_areas
            ]

            for top in top_levels:
                node = build_node(top.get("Territory"))
                if node:
                    hierarchy[top.get("Territory")] = node

        return {"hierarchy": hierarchy}

    except Exception as e:
        print(f"❌ Error: {e}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")
