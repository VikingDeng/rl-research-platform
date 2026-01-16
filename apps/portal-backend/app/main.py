from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings
from app.services.job_manager import job_manager

app = FastAPI(title=settings.app_name)
cors_origins = [origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api/v1")


@app.on_event("startup")
def start_job_manager() -> None:
    job_manager.start()


@app.on_event("shutdown")
def stop_job_manager() -> None:
    job_manager.stop()
