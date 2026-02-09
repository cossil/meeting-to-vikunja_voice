import json
import base64
import logging
import os
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from app.services.voice_service import VoiceService
from app.services.conversation_manager import ConversationManager
from app.services.vikunja_service import VikunjaService
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
    TaskBase,
)

logger = logging.getLogger(__name__)

router = APIRouter()
service = VoiceService()
conversation_manager = ConversationManager()
vikunja_service = VikunjaService()

@router.get("/warmup")
async def warmup_model():
    """Triggers a silent generation to warm up the TTS/LLM connection."""
    try:
        service.warmup_tts()
        return {"status": "warmup_initiated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/greeting")
async def get_greeting():
    """Returns the static welcome audio file."""
    # Assuming the file exists in the root or a known location. 
    # V1 had 'welcome_fixed.wav' in root.
    # We should serve it. Ideally checking path.
    file_path = os.path.join("app", "static", "welcome_fixed.wav")
    return FileResponse(file_path, media_type="audio/wav")

@router.post("/turn")
async def process_voice_turn(
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    state: str = Form(...) 
):
    """
    Process a voice turn: Audio + Current State -> Reply Audio + Updated State.
    """
    try:
        # 1. Parse State
        try:
            current_state = json.loads(state)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in 'state' field")

        if not file and not text:
            raise HTTPException(status_code=400, detail="Either 'file' or 'text' must be provided")

        # 2. Read Audio if present
        audio_bytes = await file.read() if file else None
        
        # 3. Process with Service
        updated_state, reply_audio_bytes = await service.process_turn(audio_bytes, current_state, text)
        
        # 4. Promote metadata fields out of state before sending
        reply_text = updated_state.pop('_reply_text', None)
        user_transcript = updated_state.pop('_user_transcript', None)

        # 5. Prepare Response
        response_data = {
            "updated_state": updated_state,
            "reply_audio": None,
            "reply_text": reply_text,
            "user_transcript": user_transcript,
        }
        
        if reply_audio_bytes:
            # Encode audio to Base64 to return in JSON
            b64_audio = base64.b64encode(reply_audio_bytes).decode('utf-8')
            response_data["reply_audio"] = b64_audio
            
        return JSONResponse(content=response_data)
        
    except Exception as e:
        print(f"Error in /turn: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/standard/save", response_model=SaveConversationResponse)
async def save_standard_conversation(request: SaveConversationRequest):
    """
    Save a Standard Agent conversation log.
    If sync_to_vikunja=True, also create the task in Vikunja.
    """
    now = datetime.now()
    ts_prefix = now.strftime("%Y%m%d-%H%M%S")
    session_short = request.session_id[:8] if request.session_id else "unknown"

    record = {
        "id": f"{ts_prefix}-{session_short}",
        "session_id": request.session_id,
        "timestamp": now.isoformat(),
        "agent_type": "standard",
        "agent_version": f"{service.nlu_model} + {service.tts_model}",
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
