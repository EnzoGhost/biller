import sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)

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
