# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.database import init_db
from app.models.jd_session_model import JDSession, ConversationTurn, JDVersion
from app.models.user_model import Employee
from app.routers.jd_routes import router as jd_router
from app.routers.organogram_routes import router as organogram_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs on startup — creates tables if they don't exist
    await init_db()
    yield
    # Runs on shutdown (add cleanup here if needed)


app = FastAPI(title="JD Agent API", lifespan=lifespan)

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jd_router, prefix="/jd")
app.include_router(organogram_router, prefix="/auth")