# sync_uploaded_kras.py
import asyncio
import os
import sys
import datetime
import uuid
from sqlalchemy import select

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from app.core.database import AsyncSessionLocal
from app.models.kra_kpi_model import KRAKPISession, UploadedKRAKPI
from app.models.jd_session_model import JDSession

async def sync_tables():
    print("="*80)
    print("🚀 STARTING BULK-UPLOAD KRA/KPI SANITIZATION & SYNCHRONIZATION")
    print("="*80)
    
    now = datetime.datetime.now(datetime.timezone.utc)
    
    async with AsyncSessionLocal() as db:
        async with db.begin(): # Transaction block for relational safety
            # 1. Fetch all records from uploaded_kra_kpis
            q_uploads = select(UploadedKRAKPI)
            res_uploads = await db.execute(q_uploads)
            uploads = res_uploads.scalars().all()
            print(f"Loaded {len(uploads)} records from bulk-upload registry.\n")
            
            for u in uploads:
                print(f"Processing Employee {u.employee_id} ({u.employee_name}):")
                
                # Check JD Session
                q_jd = select(JDSession).where(JDSession.employee_id == u.employee_id)
                res_jd = await db.execute(q_jd)
                jd_sessions = res_jd.scalars().all()
                
                linked_jd_id = None
                if jd_sessions:
                    # Use the first approved JD session, or any existing one
                    approved_jds = [j for j in jd_sessions if j.status == 'approved']
                    if approved_jds:
                        linked_jd_id = approved_jds[0].id
                    else:
                        linked_jd_id = jd_sessions[0].id
                    print(f"  ✅ Found existing JDSession: ID={linked_jd_id}")
                else:
                    # DIR06 or any other executive employee missing a JD Session
                    # Create an approved JD Session to keep both dashboards fully functional
                    new_jd_id = uuid.uuid4()
                    title = "Director - Corporate Strategy" if u.employee_id == "DIR06" else "Senior Executive"
                    new_jd = JDSession(
                        id=new_jd_id,
                        employee_id=u.employee_id,
                        title=title,
                        department="Corporate Office",
                        status="approved",
                        version=1,
                        jd_text=f"Approved role guidelines for {title}.",
                        jd_structured={
                            "title": title,
                            "department": "Corporate Office",
                            "key_responsibilities": ["Executive alignment and corporate governance."]
                        },
                        created_at=now,
                        updated_at=now
                    )
                    db.add(new_jd)
                    linked_jd_id = new_jd_id
                    print(f"  ⚠️ No JDSession found. Generated & approved placeholder JDSession: ID={linked_jd_id}")
                
                # Check if KRAKPISession exists
                q_kk = select(KRAKPISession).where(KRAKPISession.employee_id == u.employee_id)
                res_kk = await db.execute(q_kk)
                kk_session = res_kk.scalar_one_or_none()
                
                # Ensure the linked JDSession ID is cast to string as required by String(36) mapping
                jd_session_str = str(linked_jd_id) if linked_jd_id else None
                
                if kk_session:
                    print(f"  🔄 Found existing KRAKPISession (ID={kk_session.id}, status='{kk_session.status}'). Upgrading & Sanitizing...")
                    kk_session.kras = u.kras
                    kk_session.status = "approved"
                    kk_session.generation_step = "confirmed"
                    kk_session.jd_session_id = jd_session_str
                    kk_session.confirmed_at = now
                    kk_session.reviewed_at = now
                    kk_session.reviewed_by = "System Admin"
                    kk_session.reviewer_comment = "Synchronized and sanitized with approved bulk-uploaded KRA/KPI datasheet."
                    kk_session.updated_at = now
                    print("  ✅ Session upgraded successfully.")
                else:
                    print("  ➕ No KRAKPISession found. Initializing and approving new session...")
                    new_kk_id = uuid.uuid4()
                    new_kk = KRAKPISession(
                        id=new_kk_id,
                        employee_id=u.employee_id,
                        jd_session_id=jd_session_str,
                        kras=u.kras,
                        status="approved",
                        generation_step="confirmed",
                        confirmed_at=now,
                        reviewed_at=now,
                        reviewed_by="System Admin",
                        reviewer_comment="Synchronized and initialized from approved bulk-uploaded KRA/KPI datasheet.",
                        created_at=now,
                        updated_at=now
                    )
                    db.add(new_kk)
                    print(f"  ✅ Created new approved KRAKPISession: ID={new_kk_id}")
                print("-" * 60)
                
    print("\n🎉 All bulk-uploaded KRA/KPI entries have been sanitized, reconciled, and approved in the system database!")

if __name__ == "__main__":
    asyncio.run(sync_tables())
