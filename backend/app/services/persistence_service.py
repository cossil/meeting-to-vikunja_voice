import logging
from datetime import datetime
from app.services.conversation_manager import ConversationManager
from app.services.vikunja_service import VikunjaService
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
    TaskBase,
    ConversationTaskDraft,
)

logger = logging.getLogger(__name__)

# Module-level singletons (consistent with existing pattern in endpoints)
_default_cm = ConversationManager()
_default_vs = VikunjaService()


def _map_draft_to_task(draft: ConversationTaskDraft) -> TaskBase:
    """Convert a ConversationTaskDraft into a TaskBase for Vikunja sync."""
    return TaskBase(
        title=draft.title,
        description=draft.description,
        assignee_name=draft.assignee,
        priority=draft.priority,
        due_date=draft.due_date,
    )


def _extract_sync_error(record: dict) -> str | None:
    """Extract sync error string from the record's sync_result, if any."""
    sync_result = record.get("sync_result")
    if sync_result:
        return sync_result.get("error")
    return None


async def save_conversation(
    request: SaveConversationRequest,
    *,
    agent_type: str,
    agent_version: str,
    user_id: str | None = None,
    conversation_manager: ConversationManager = _default_cm,
    vikunja_service: VikunjaService = _default_vs,
) -> SaveConversationResponse:
    """
    Unified conversation persistence.
    Builds the record, optionally syncs to Vikunja, persists to disk.

    Args:
        request: Validated save payload.
        agent_type: "standard" or "live".
        agent_version: Model ID string(s) identifying the agent.
        user_id: Reserved for Phase 11 (auth/multi-tenancy). Stored in record when present.
        conversation_manager: Injectable for testing; defaults to module singleton.
        vikunja_service: Injectable for testing; defaults to module singleton.
    """
    now = datetime.now()
    ts_prefix = now.strftime("%Y%m%d-%H%M%S")
    session_short = request.session_id[:8] if request.session_id else "unknown"

    record = {
        "id": f"{ts_prefix}-{session_short}",
        "session_id": request.session_id,
        "timestamp": now.isoformat(),
        "agent_type": agent_type,
        "agent_version": agent_version,
        "synced_to_vikunja": False,
        "sync_result": None,
        "transcript": [t.model_dump() for t in request.transcript],
        "task_draft": request.task_draft.model_dump(),
    }

    # Phase 11 hook: attach owner when authenticated
    if user_id is not None:
        record["owner_id"] = user_id

    # Sync to Vikunja if requested
    if request.sync_to_vikunja and request.task_draft.title:
        task = _map_draft_to_task(request.task_draft)
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
            sync_error=_extract_sync_error(record),
        )

    return SaveConversationResponse(
        conversation_id=record["id"],
        saved=True,
        synced=record["synced_to_vikunja"],
        sync_error=_extract_sync_error(record),
    )
