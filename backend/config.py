from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-change-in-production"
    DEBUG: bool = True
    PORT: int = 8100

    DATABASE_URL: str = "sqlite+aiosqlite:///./biller.db"

    STEDI_API_KEY: str = ""
    STEDI_ISA_SENDER_ID: str = ""
    STEDI_ISA_SENDER_QUALIFIER: str = "ZZ"

    INMEDIATA_SFTP_HOST: str = "sftp.inmediata.com"
    INMEDIATA_SFTP_USER: str = ""
    INMEDIATA_SFTP_PASSWORD: str = ""
    INMEDIATA_SUBMITTER_ID: str = ""

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FAX_FROM: str = ""

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    WINK_DB_PATH: str = ""

    CORS_ORIGINS: str = "http://localhost:5174,http://127.0.0.1:5174"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
