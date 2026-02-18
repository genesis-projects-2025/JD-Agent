# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.database import init_db
from app.models.questionnaire_model import Questionnaire  # must import so Base sees it
from app.routers.jd_routes import router


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
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/jd")