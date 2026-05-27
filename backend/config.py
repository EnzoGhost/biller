import os
import base64
import logging
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from pydantic_settings import BaseSettings
from typing import List

logger = logging.getLogger("config")


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-change-in-production"
    DEBUG: bool = True
    PORT: int = 8100

    DATABASE_URL: str = "sqlite+aiosqlite:///./angelclaims.db"

    STEDI_API_KEY: str = "test_7ONIdmf.E4zgLsNHAdLr3CN3poSOZWLt"
    STEDI_ISA_SENDER_ID: str = ""
    STEDI_ISA_SENDER_QUALIFIER: str = "ZZ"

    INMEDIATA_SFTP_HOST: str = "sftp.inmediata.com"
    INMEDIATA_SFTP_USER: str = ""
    INMEDIATA_SFTP_PASSWORD: str = ""
    INMEDIATA_SFTP_UPLOAD_DIR: str = "/UPLOAD/837"
    INMEDIATA_SFTP_DOWNLOAD_DIR: str = "/DOWNLOAD/835"
    INMEDIATA_SUBMITTER_ID: str = ""
    # SecureTrack Web Service credentials (alternative to SFTP)
    INMEDIATA_WS_USERNAME: str = ""
    INMEDIATA_WS_PASSWORD: str = ""
    INMEDIATA_WS_ENV: str = "uat"  # "uat" or "prod"

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FAX_FROM: str = ""

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    ANGELWINK_DB_PATH: str = ""

    # Availity / Envolve Vision integration
    AVAILITY_CLIENT_ID: str = ""
    AVAILITY_CLIENT_SECRET: str = ""
    AVAILITY_PAYER_ID: str = "56190"  # Envolve Vision payer ID
    AVAILITY_BASE_URL: str = "https://api.availity.com"

    CORS_ORIGINS: str = "http://localhost:5174,http://127.0.0.1:5174,tauri://localhost,https://tauri.localhost,https://admin.angelclaims.app,https://app.angelclaims.app"

    # Public URL for QR scanner camera links (set this in production)
    APP_URL: str = "http://localhost:8100"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


# ── Fernet Encryption Helpers ────────────────────────────────────────────────

def _get_encryption_key() -> bytes:
    """Return (or generate) a Fernet key that persists across restarts.

    Priority:
      1. ENCRYPTION_KEY env var (base64-url-safe 32-byte key)
      2. .encryption_key file next to the SQLite DB
      3. Generate a new key → write to .encryption_key
    """
    env_key = os.environ.get("ENCRYPTION_KEY")
    if env_key:
        return env_key.encode()

    # Derive key file path from DATABASE_URL
    db_url = settings.DATABASE_URL
    if "///" in db_url:
        db_path = db_url.split("///", 1)[1]
    else:
        db_path = "./angelclaims.db"
    key_file = Path(db_path).resolve().parent / ".encryption_key"

    if key_file.exists():
        return key_file.read_text().strip().encode()

    # Generate and persist
    new_key = Fernet.generate_key()
    try:
        key_file.write_text(new_key.decode())
        key_file.chmod(0o600)
        logger.info("Generated new encryption key at %s", key_file)
    except OSError as e:
        logger.warning("Could not persist encryption key to %s: %s", key_file, e)
    return new_key


_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_get_encryption_key())
    return _fernet


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string → URL-safe base64 ciphertext string."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt ciphertext back to plaintext.

    If decryption fails (e.g. legacy plaintext value), returns the
    input as-is so existing unencrypted passwords keep working.
    """
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        # Likely a legacy plaintext password — return as-is
        return ciphertext
