from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    GROQ_API_KEY: str
    DATABASE_NAME: str
    DATABASE_USER_NAME: str
    DATABASE_PASS: str

    class Config:
        env_file = ".env"

settings = Settings()
