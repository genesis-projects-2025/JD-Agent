# app/core/config.py
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus


class Settings(BaseSettings):
    GROQ_API_KEY: str
    DATABASE_NAME: str
    DATABASE_USER_NAME: str
    DATABASE_PASS: str
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 5432
    GEMINI_API_KEY: str=""
    PINECONE_API_KEY: str=""
    @property
    def DATABASE_URL(self) -> str:
        encoded_pass = quote_plus(self.DATABASE_PASS)
        return (
            f"postgresql+asyncpg://{self.DATABASE_USER_NAME}:"
            f"{encoded_pass}@{self.DATABASE_HOST}:"
            f"{self.DATABASE_PORT}/{self.DATABASE_NAME}"
        )

    class Config:
        env_file = ".env"


settings = Settings()