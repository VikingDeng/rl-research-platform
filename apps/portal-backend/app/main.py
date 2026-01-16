import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

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

@app.middleware("http")
async def add_csp_header(request: Request, call_next):
    response = await call_next(request)
    # Allow unsafe-eval and unsafe-inline to fix frontend loading issues
    response.headers["Content-Security-Policy"] = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https: ws: wss:;"
    return response

app.include_router(router, prefix="/api/v1")

# --- Frontend Static Serving ---
# Allow override via environment variable, otherwise use default path
env_frontend_dist = os.getenv("FRONTEND_DIST")
if env_frontend_dist:
    FRONTEND_DIST = Path(env_frontend_dist)
else:
    # Adjust path relative to this file: apps/portal-backend/app/main.py
    # Frontend dist is at: apps/portal-frontend/dist
    BACKEND_ROOT = Path(__file__).resolve().parent.parent
    FRONTEND_DIST = BACKEND_ROOT.parent / "portal-frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/")
    async def serve_spa_root():
        return FileResponse(FRONTEND_DIST / "index.html")
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # API requests are handled by include_router above.
        # This catch-all serves index.html for client-side routing
        if full_path.startswith("api"):
            return {"error": "api_route_not_found"}
            
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
            
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    print(f"[Warning] Frontend dist not found at {FRONTEND_DIST}. Running in API-only mode.")


@app.on_event("startup")
def start_job_manager() -> None:
    job_manager.start()


@app.on_event("shutdown")
def stop_job_manager() -> None:
    job_manager.stop()
