import logging
import sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

# Suppress verbose SQLAlchemy logging in production
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

engine = create_async_engine(settings.DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    from models import Base  # noqa: F401 — import all models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Migrate: add multi-tenancy columns if not present
    async with engine.begin() as conn:
        multi_tenant_migrations = [
            # organizations table handled by create_all
            # Add organization_id to providers
            ("providers", "organization_id", "INTEGER REFERENCES organizations(id)"),
            # Add provider_id to patients
            ("patients", "provider_id", "INTEGER REFERENCES providers(id)"),
            # Add provider_id to fee_schedule
            ("fee_schedule", "provider_id", "INTEGER REFERENCES providers(id)"),
            # Add provider_id to prior_auths
            ("prior_auths", "provider_id", "INTEGER REFERENCES providers(id)"),
        ]
        for table, col, col_def in multi_tenant_migrations:
            try:
                await conn.execute(
                    sqlalchemy.text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
                )
            except Exception:
                pass  # Column already exists

    # Migrate: add VistaNet credential columns to clinic_settings if missing
    async with engine.begin() as conn:
        for col_name, col_type in [
            ("vistanet_username", "VARCHAR(100)"),
            ("vistanet_password", "VARCHAR(255)"),
            ("vistanet_location", "VARCHAR(100)"),
        ]:
            try:
                await conn.execute(
                    sqlalchemy.text(f"ALTER TABLE clinic_settings ADD COLUMN {col_name} {col_type}")
                )
            except Exception:
                pass  # Column already exists

    # Migrate: add ai_verified columns to patient_insurances if missing
    async with engine.begin() as conn:
        for col_name, col_def in [
            ("ai_verified", "BOOLEAN NOT NULL DEFAULT 0"),
            ("ai_verified_at", "DATETIME"),
        ]:
            try:
                await conn.execute(
                    sqlalchemy.text(f"ALTER TABLE patient_insurances ADD COLUMN {col_name} {col_def}")
                )
            except Exception:
                pass  # Column already exists

    # Migrate: add language column to users if missing
    async with engine.begin() as conn:
        try:
            await conn.execute(
                sqlalchemy.text("ALTER TABLE users ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'en'")
            )
        except Exception:
            pass  # Column already exists
