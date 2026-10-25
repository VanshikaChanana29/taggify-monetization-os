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

    # Cloudflare R2 for uploaded files. Leave empty to keep files in the database (local dev).
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""

    # YouTube channel tokens are stored encrypted with this key (Fernet; generate once with
    # `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
    token_encryption_key: str = ""
    # Shared secret the daily scheduler (cron-job.org) sends to start the YouTube sync.
    sync_secret: str = ""

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
