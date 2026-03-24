from typing import List
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_user
from app.models.auth_schemas import User
from app.models.schemas import HistorySummary, HistoryDetail
from app.services.history_manager import HistoryManager

router = APIRouter()
history_manager = HistoryManager()


def _owner_filter(user: User) -> str | None:
    """Return owner_id for regular users, None for admins (see-all bypass)."""
    return None if user.role == "admin" else user.id


@router.get("/history", response_model=List[HistorySummary])
async def list_history(current_user: User = Depends(get_current_user)):
    """Return lightweight summaries of all saved analyses, newest first."""
    return history_manager.list_all(owner_id=_owner_filter(current_user))


@router.get("/history/{history_id}", response_model=HistoryDetail)
async def get_history_detail(history_id: str, current_user: User = Depends(get_current_user)):
    """Return the full JSON content for a specific analysis."""
    result = history_manager.get_by_id(history_id, owner_id=_owner_filter(current_user))
    if result is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return result
