from fastapi import FastAPI

app = FastAPI(title="JD Agent API")

@app.get("/health")
async def health():
    return {"status": "ok"}
