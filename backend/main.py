"""
Medical Biller PR — FastAPI Backend
Port: 8100
"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from config import settings
from database import init_db

from routers import auth, claims, patients, payers, providers, denials, stedi, ai, imports, dashboard, inmediata
from routers import validation, payments, audit, approvals
from routers import availity, templates, prior_auth, followup, clinic, vistanet, fee_schedule


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Medical Biller PR",
    description="Medical billing platform for Puerto Rico — API backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(patients.router, prefix="/api")
app.include_router(providers.router, prefix="/api")
app.include_router(payers.router, prefix="/api")
app.include_router(claims.router, prefix="/api")
app.include_router(denials.router, prefix="/api")
app.include_router(stedi.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(inmediata.router, prefix="/api")
app.include_router(validation.router, prefix="/api")
app.include_router(payments.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(availity.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(prior_auth.router, prefix="/api")
app.include_router(approvals.router, prefix="/api")
app.include_router(followup.router, prefix="/api")
app.include_router(clinic.router, prefix="/api")
app.include_router(vistanet.router, prefix="/api")
app.include_router(fee_schedule.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Medical Biller PR", "version": "1.0.0"}


# ── Serve frontend static files in production ────────────────────────
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.is_dir():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="frontend-assets")

    # SPA fallback: serve index.html for all non-API routes
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        # If a static file exists, serve it
        file_path = STATIC_DIR / path
        if file_path.is_file():
            return FileResponse(file_path)
        # Otherwise serve index.html (SPA routing)
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=settings.DEBUG)
