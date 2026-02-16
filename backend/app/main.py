from fastapi import FastAPI

app = FastAPI(title="JD Agent API")
origins = [
    "http://localhost:3000",  # React / Next frontend
    "http://localhost:3001",  # React / Next frontend
]

@app.get("/health")
async def health():
    return {"status": "ok"}
