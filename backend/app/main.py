import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.endpoints import batch, voice, live, glossary, history, conversations, auth, admin
from app.services.user_manager import user_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    # Startup: ensure default admin exists
    try:
        user_manager.ensure_admin_exists()
    except Exception:
        logger.error("Failed to bootstrap admin user", exc_info=True)
    yield


app = FastAPI(
    title="MeetingToVikunja API",
    version="2.0.0",
    description="Backend API for processing meeting notes and syncing to Vikunja.",
    lifespan=lifespan,
)

# CORS Configuration — production domains + localhost dev
_extra = os.getenv("CORS_ORIGINS", "")
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://meeting.hankell.com.br",
] + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(batch.router, prefix="/api/v1", tags=["Analysis"])
app.include_router(voice.router, prefix="/api/v1/voice", tags=["Voice"])
app.include_router(live.router, prefix="/api/v1/voice", tags=["Voice (Live)"])
app.include_router(glossary.router, prefix="/api/v1", tags=["Glossary"])
app.include_router(history.router, prefix="/api/v1", tags=["History"])
app.include_router(conversations.router, prefix="/api/v1", tags=["Conversations"])
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])
# app.include_router(vikunja.router, prefix="/api/v1", tags=["Vikunja"]) # Placeholder/Commented out for Phase 1

@app.get("/health")
async def health_check():
    return {"status": "ok"}
