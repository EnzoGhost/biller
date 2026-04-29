"""
Medical Biller PR — FastAPI Backend
Port: 8100
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import settings
from database import init_db

from routers import auth, claims, patients, payers, providers, denials, stedi, ai, imports, dashboard, inmediata
from routers import validation, payments, audit
from routers import availity, templates, prior_auth, followup, clinic, vistanet


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
app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(providers.router)
app.include_router(payers.router)
app.include_router(claims.router)
app.include_router(denials.router)
app.include_router(stedi.router)
app.include_router(ai.router)
app.include_router(imports.router)
app.include_router(dashboard.router)
app.include_router(inmediata.router)
app.include_router(validation.router)
app.include_router(payments.router)
app.include_router(audit.router)
app.include_router(availity.router)
app.include_router(templates.router)
app.include_router(prior_auth.router)
app.include_router(followup.router)
app.include_router(clinic.router)
app.include_router(vistanet.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Medical Biller PR", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=settings.DEBUG)
