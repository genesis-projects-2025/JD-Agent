from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI(title="JD Agent API")
origins = [
    "http://localhost:3000",  # React / Next frontend
    "http://localhost:3001",  # React / Next frontend
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # allowed frontend URLs
    allow_credentials=True,
    allow_methods=["*"],    # allow all HTTP methods
    allow_headers=["*"],    # allow all headers
)

@app.get("/")
async def root():
    return {"status": "ok"}

def init_app():
    print("JD Agent API Initialized Successfully")
    return app