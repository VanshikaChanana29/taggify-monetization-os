from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    database_url: str = "postgresql://taggify:taggify_dev@localhost:5432/taggify_dev"

    # Login sessions
    session_cookie_name: str = "taggify_session"
    session_days: int = 7
    cookie_secure: bool = False  # True on Render (HTTPS)
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    @property
    def sqlalchemy_url(self) -> str:
        # Render gives "postgres://" or "postgresql://"; SQLAlchemy needs the psycopg3 driver.
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
