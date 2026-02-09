from typing import List
from fastapi import APIRouter, HTTPException
from app.models.schemas import ConversationSummary
from app.services.conversation_manager import ConversationManager

router = APIRouter()
conversation_manager = ConversationManager()


@router.get("/conversations", response_model=List[ConversationSummary])
async def list_conversations():
    """Return lightweight summaries of all saved conversations, newest first."""
    return conversation_manager.list_all()


@router.get("/conversations/{conversation_id}")
async def get_conversation_detail(conversation_id: str):
    """Return the full JSON content for a specific conversation."""
    result = conversation_manager.get_by_id(conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result
