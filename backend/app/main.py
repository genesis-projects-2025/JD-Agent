# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
from app.version import VERSION
from app.core.database import init_db
import app.models  # Ensure models are registered for init_db
from app.routers.jd_routes import router as jd_router
from app.routers.organogram_routes import router as organogram_router
from app.routers.admin_routes import router as admin_router
from app.routers.hr_routes import router as hr_router
from app.routers.feedback_routes import router as feedback_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs on startup — creates tables if they don't exist
    await init_db()
    yield
    # Runs on shutdown (add cleanup here if needed)


app = FastAPI(title="JD Agent API", version=VERSION, lifespan=lifespan)

origins = [
    "https://jd-agent-kappa.vercel.app",
    "https://jd.web3vers.me/",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(jd_router, prefix="/jd", tags=["JD Routes"])
app.include_router(organogram_router, prefix="/auth")
app.include_router(admin_router)
app.include_router(feedback_router)
app.include_router(hr_router, prefix="/api/hr", tags=["HR Dashboard"])
