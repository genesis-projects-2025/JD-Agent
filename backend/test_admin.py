import sys
import os
# ensure we can import 'app'
sys.path.insert(0, os.path.abspath('.'))

import asyncio
from app.core.database import SessionLocal
from app.routers.admin_routes import get_admin_overview

async def run():
    db = SessionLocal()
    try:
        print(get_admin_overview(db))
    except Exception as e:
        import traceback
        traceback.print_exc()
        
asyncio.run(run())
