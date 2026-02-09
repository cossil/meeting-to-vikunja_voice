import logging
from datetime import datetime
from fastapi import APIRouter, WebSocket
from app.services.live_session import GeminiLiveSession
from app.services.conversation_manager import ConversationManager
from app.services.vikunja_service import VikunjaService
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
    TaskBase,
)

logger = logging.getLogger(__name__)

router = APIRouter()
conversation_manager = ConversationManager()
vikunja_service = VikunjaService()

# Model ID must match live_session.py — single source of truth
_LIVE_MODEL_ID = "gemini-2.5-flash-native-audio-preview-12-2025"


@router.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    session = GeminiLiveSession()
    await session.start(websocket)


@router.post("/live/save", response_model=SaveConversationResponse)
async def save_conversation(request: SaveConversationRequest):
    """
    Save a Live Agent conversation log.
    If sync_to_vikunja=True, also create the task in Vikunja.
    """
    now = datetime.now()
    ts_prefix = now.strftime("%Y%m%d-%H%M%S")
    session_short = request.session_id[:8] if request.session_id else "unknown"

    record = {
        "id": f"{ts_prefix}-{session_short}",
        "session_id": request.session_id,
        "timestamp": now.isoformat(),
        "agent_type": "live",
        "agent_version": _LIVE_MODEL_ID,
        "synced_to_vikunja": False,
        "sync_result": None,
        "transcript": [t.model_dump() for t in request.transcript],
        "task_draft": request.task_draft.model_dump(),
    }

    # Sync to Vikunja if requested
    if request.sync_to_vikunja and request.task_draft.title:
        task = TaskBase(
            title=request.task_draft.title,
            description=request.task_draft.description,
            assignee_name=request.task_draft.assignee,
            priority=request.task_draft.priority,
            due_date=request.task_draft.due_date,
        )
        try:
            success = await vikunja_service.create_task(task)
            record["synced_to_vikunja"] = success
            record["sync_result"] = {"success": success}
        except Exception as e:
            logger.error("Vikunja sync failed: %s", e, exc_info=True)
            record["sync_result"] = {"success": False, "error": str(e)}

    # Always save conversation to disk
    try:
        conversation_manager.save(record)
    except Exception:
        logger.exception("Conversation save failed")
        return SaveConversationResponse(
            conversation_id=record["id"],
            saved=False,
            synced=record["synced_to_vikunja"],
            sync_error=record.get("sync_result", {}).get("error") if record.get("sync_result") else None,
        )

    return SaveConversationResponse(
        conversation_id=record["id"],
        saved=True,
        synced=record["synced_to_vikunja"],
        sync_error=record.get("sync_result", {}).get("error") if record.get("sync_result") else None,
    )
