import os
import mimetypes
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.api.routes import router
from app.core.config import settings
from app.services.job_manager import job_manager

app = FastAPI(title=settings.app_name)

@app.middleware("http")
async def csp_middleware(request: Request, call_next):
    response = await call_next(request)
    # Allow disabling CSP entirely for intranet use
    if os.getenv("DISABLE_CSP", "0") == "1":
        # Strip CSP headers entirely.
        for header in (
            "Content-Security-Policy",
            "Content-Security-Policy-Report-Only",
            "X-Content-Security-Policy",
            "X-WebKit-CSP",
        ):
            if header in response.headers:
                del response.headers[header]
        return response
    # Permissive CSP (still allows eval/inline) if not disabled
    response.headers["Content-Security-Policy"] = (
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; "
        "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; "
        "style-src * data: blob: 'unsafe-inline'; "
        "img-src * data: blob:; "
        "font-src * data: blob:; "
        "connect-src * data: blob:; "
        "frame-src * data: blob:;"
    )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "service": settings.app_name}

# Ensure correct MIME types for JS/CSS on minimal Linux images
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")

# --- Frontend Static Serving ---
# Allow override via environment variable, otherwise use default path
env_frontend_dist = os.getenv("FRONTEND_DIST")
if env_frontend_dist:
    FRONTEND_DIST = Path(env_frontend_dist)
else:
    # Adjust path relative to this file: apps/portal-backend/app/main.py
    # Frontend dist is at: dist (project root)
    BACKEND_ROOT = Path(__file__).resolve().parent.parent
    FRONTEND_DIST = BACKEND_ROOT.parent.parent / "dist"

print(f"[System] Frontend Dist Path: {FRONTEND_DIST}")
print(f"[System] Assets Path: {FRONTEND_DIST / 'assets'}")

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")
    spa_headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}

    @app.get("/")
    async def serve_spa_root():
        return FileResponse(FRONTEND_DIST / "index.html", headers=spa_headers)
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # API requests are handled by include_router above.
        # This catch-all serves index.html for client-side routing
        if full_path.startswith("api"):
            return {"error": "api_route_not_found"}
        if full_path.startswith("artifacts"):
             # Fallback if the static mount below didn't catch it for some reason, 
             # but usually it should be handled by `app.mount("/artifacts")`.
             # We just return 404 here.
             return {"error": "artifact_not_found"}

        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
            
        return FileResponse(FRONTEND_DIST / "index.html", headers=spa_headers)
else:
    print(f"[Warning] Frontend dist not found at {FRONTEND_DIST}. Running in API-only mode.")

# --- Local Artifact Serving (For non-S3/MinIO mode) ---
LOCAL_ARTIFACTS = Path(settings.local_run_root).parent / "artifacts"
if LOCAL_ARTIFACTS.exists():
    print(f"[System] Serving Local Artifacts at: {LOCAL_ARTIFACTS}")
    app.mount("/artifacts", StaticFiles(directory=LOCAL_ARTIFACTS), name="artifacts")
else:
    # Ensure it exists so we can mount it? Or just create it on startup.
    # It's better to create it.
    LOCAL_ARTIFACTS.mkdir(parents=True, exist_ok=True)
    print(f"[System] Initialized Local Artifacts at: {LOCAL_ARTIFACTS}")
    app.mount("/artifacts", StaticFiles(directory=LOCAL_ARTIFACTS), name="artifacts")


@app.on_event("startup")
def start_job_manager() -> None:
    job_manager.start()


@app.on_event("shutdown")
def stop_job_manager() -> None:
    job_manager.stop()
