# main.py
import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import text
from .version import VERSION
from .core.database import init_db, engine
import app.models  # Ensure models are registered for init_db
from app.core.config import settings
from app.core.cache import cache_health
from app.services.vector_service import vector_health
from app.routers.jd_routes import router as jd_router
from app.routers.organogram_routes import router as organogram_router
from app.routers.admin_routes import router as admin_router
from app.routers.hr_routes import router as hr_router
from app.routers.feedback_routes import router as feedback_router
from app.routers.admin_jd_routes import router as admin_jd_router
from app.routers.kra_kpi_routes import router as kra_kpi_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs on startup — creates tables if they don't exist
    logger.info("🚀 Starting JD Agent API initialization...")
    try:
        # Check if Redis is responsive
        from app.core.cache import check_redis_connection
        await check_redis_connection()
    except Exception as e:
        logger.error(f"Error checking Redis connection: {e}")

    try:
        # Add 30-second timeout to startup initialization
        await asyncio.wait_for(init_db(), timeout=30.0)
        logger.info("✅ Database initialization completed successfully")
    except asyncio.TimeoutError:
        logger.error("⏱️ Database initialization timed out after 30s - continuing anyway")
    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e} - continuing anyway")
    
    logger.info("✅ API initialization complete - server ready to accept requests")
    yield
    logger.info("🛑 Shutting down JD Agent API...")
    # Runs on shutdown (add cleanup here if needed)


app = FastAPI(title="JD Agent API", version=VERSION, lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(jd_router, prefix="/jd", tags=["JD Routes"])
app.include_router(organogram_router, prefix="/auth")
app.include_router(admin_router)
app.include_router(admin_jd_router, tags=["Admin JDs"])
app.include_router(feedback_router)
app.include_router(hr_router, prefix="/api/hr", tags=["HR Dashboard"])
app.include_router(kra_kpi_router)


@app.get("/health/live")
async def health_live():
    return {"status": "ok", "service": "jd-agent-api", "version": VERSION}


@app.get("/health/ready")
async def health_ready():
    db_status = {"status": "degraded"}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = {"status": "ok"}
    except Exception as e:
        db_status = {"status": "degraded", "detail": str(e)}

    cache_status, vector_status = await asyncio.gather(
        cache_health(),
        vector_health(),
    )
    overall = "ok" if db_status["status"] == "ok" else "degraded"
    return {
        "status": overall,
        "dependencies": {
            "database": db_status,
            "cache": cache_status,
            "vector": vector_status,
        },
        "version": VERSION,
    }
