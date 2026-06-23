# app/core/config.py
from pathlib import Path
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings



class Settings(BaseSettings):
    DATABASE_NAME: str
    DATABASE_USER_NAME: str
    DATABASE_PASS: str
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 5432
    DATABASE_SSL: str = "require"  # Default to require for security, used as sslmode
    GEMINI_API_KEY: str
    # Security info
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480 # 8 hours

    # Simple Admin Credentials (In real enterprise, move to DB)
    ADMIN_CODE: str
    ADMIN_PASSWORD: str
    
    PINECONE_API_KEY: str = ""
    PINECONE_INDEX_NAME: str = "jd-agent"

    # Redis configuration
    REDIS_URL: str = "redis://localhost:6379"

    # CORS
    CORS_ORIGINS: str = "https://jd.pulsepharma.net,http://localhost:3000"
    STORAGE_DIR_NAME: str = "storage"

    # Langfuse configuration
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""
    LANGFUSE_BASE_URL: str = "https://cloud.langfuse.com"

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse comma-separated CORS_ORIGINS into a list."""
        if not self.CORS_ORIGINS:
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def DATABASE_URL(self) -> str:
        """Return a database URL.
        If any of the required PostgreSQL settings are missing, fall back to an
        in‑memory SQLite database for local development and testing.
        """
        required = [self.DATABASE_NAME, self.DATABASE_USER_NAME, self.DATABASE_PASS]
        if any(not v for v in required):
            # Use SQLite in the backend root directory for simplicity
            return f"sqlite+aiosqlite:///{self.backend_root / 'test.db'}"
        encoded_pass = quote_plus(self.DATABASE_PASS)
        return (
            f"postgresql+asyncpg://{self.DATABASE_USER_NAME}:"
            f"{encoded_pass}@{self.DATABASE_HOST}:"
            f"{self.DATABASE_PORT}/{self.DATABASE_NAME}"
        )

    @property
    def backend_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    @property
    def storage_root(self) -> Path:
        return self.backend_root / self.STORAGE_DIR_NAME

    @property
    def jd_upload_dir(self) -> Path:
        return self.storage_root / "uploads" / "jds"

    class Config:
        env_file = ".env"


# type: ignore is needed because pydantic-settings populates these from the environment, but static checkers don't know that
settings = Settings() # type: ignore
