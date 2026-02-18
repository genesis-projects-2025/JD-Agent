# app/core/config.py
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus


class Settings(BaseSettings):
    GROQ_API_KEY: str
    DATABASE_NAME: str
    DATABASE_USER_NAME: str
    DATABASE_PASS: str
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 3306

    @property
    def DATABASE_URL(self) -> str:
        # ✅ quote_plus encodes special characters like @ # % in password
        encoded_pass = quote_plus(self.DATABASE_PASS)
        return (
            f"mysql+aiomysql://{self.DATABASE_USER_NAME}:"
            f"{encoded_pass}@{self.DATABASE_HOST}:"
            f"{self.DATABASE_PORT}/{self.DATABASE_NAME}"
        )

    class Config:
        env_file = ".env"


settings = Settings()