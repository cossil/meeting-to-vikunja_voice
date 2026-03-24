import json
import base64
import logging
import os
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from app.core.security import get_current_user
from app.models.auth_schemas import User
from app.services.voice_service import VoiceService
from app.services.persistence_service import save_conversation
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()
service = VoiceService()

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
    state: str = Form(...),
    current_user: User = Depends(get_current_user),
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
        mime_type = file.content_type if file else None
        
        # 3. Process with Service
        updated_state, reply_audio_bytes = await service.process_turn(audio_bytes, current_state, text, mime_type=mime_type)
        
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
async def save_standard_conversation(request: SaveConversationRequest, current_user: User = Depends(get_current_user)):
    """
    Save a Standard Agent conversation log.
    If sync_to_vikunja=True, also create the task in Vikunja.
    """
    return await save_conversation(
        request,
        agent_type="standard",
        agent_version=f"{service.nlu_model} + {service.tts_model}",
        user_id=current_user.id,
    )
