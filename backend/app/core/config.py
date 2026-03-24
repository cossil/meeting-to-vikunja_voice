import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    GOOGLE_API_KEY: str
    VIKUNJA_API_TOKEN: str
    VIKUNJA_API_URL: str

    # Auth / JWT
    JWT_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24

    # Default admin credentials (used on first startup only)
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin1234"

    class Config:
        env_file = (".env", "../.env")
        extra = "ignore"


settings = Settings()
