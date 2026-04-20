from pydantic_settings import BaseSettings
from typing import List
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://knmp_user:knmp_secure_password@localhost:5432/knmp_monitor"
    SECRET_KEY: str = "dev-secret-change-in-production-min-32-chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DEBUG: bool = True
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 20

    WA_PROVIDER: str = "fonnte"
    WA_API_URL: str = "https://api.fonnte.com/send"
    WA_API_TOKEN: str = ""
    WA_ENABLED: bool = False

    SCHEDULER_ENABLED: bool = True
    DAILY_CHECK_HOUR: int = 7

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
