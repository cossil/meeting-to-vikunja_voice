from typing import List
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_user
from app.models.auth_schemas import User
from app.models.schemas import ConversationSummary
from app.services.conversation_manager import ConversationManager

router = APIRouter()
conversation_manager = ConversationManager()


def _owner_filter(user: User) -> str | None:
    """Return owner_id for regular users, None for admins (see-all bypass)."""
    return None if user.role == "admin" else user.id


@router.get("/conversations", response_model=List[ConversationSummary])
async def list_conversations(current_user: User = Depends(get_current_user)):
    """Return lightweight summaries of all saved conversations, newest first."""
    return conversation_manager.list_all(owner_id=_owner_filter(current_user))


@router.get("/conversations/{conversation_id}")
async def get_conversation_detail(conversation_id: str, current_user: User = Depends(get_current_user)):
    """Return the full JSON content for a specific conversation."""
    result = conversation_manager.get_by_id(conversation_id, owner_id=_owner_filter(current_user))
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result
