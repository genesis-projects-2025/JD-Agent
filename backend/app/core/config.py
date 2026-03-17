# app/core/config.py
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings



class Settings(BaseSettings):
    DATABASE_NAME: str
    DATABASE_USER_NAME: str
    DATABASE_PASS: str
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 5432
    DATABASE_SSL: str = "require"  # Default to require for security
    GEMINI_API_KEY: str = ""
    # Security info
    SECRET_KEY: str = "super-secret-key-for-admin-auth-12345" # Change in production
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480 # 8 hours
    
    # Simple Admin Credentials (In real enterprise, move to DB)
    ADMIN_CODE: str = "adminpulse"
    ADMIN_PASSWORD: str = "admin@123"
    
    PINECONE_API_KEY: str = ""

    # Redis configuration
    REDIS_URL: str = "redis://localhost:6379"

    # CORS
    CORS_ORIGINS: str = "https://jd.pulsepharma.net,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse comma-separated CORS_ORIGINS into a list."""
        if not self.CORS_ORIGINS:
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def DATABASE_URL(self) -> str:
        encoded_pass = quote_plus(self.DATABASE_PASS)
        return (
            f"postgresql+asyncpg://{self.DATABASE_USER_NAME}:"
            f"{encoded_pass}@{self.DATABASE_HOST}:"
            f"{self.DATABASE_PORT}/{self.DATABASE_NAME}"
            f"?ssl={self.DATABASE_SSL}"   # ADD THIS LINE
        )

    class Config:
        env_file = ".env"


# type: ignore is needed because pydantic-settings populates these from the environment, but static checkers don't know that
settings = Settings() # type: ignore
