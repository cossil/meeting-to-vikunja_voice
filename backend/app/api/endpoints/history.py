from typing import List
from fastapi import APIRouter, HTTPException
from app.models.schemas import HistorySummary, HistoryDetail
from app.services.history_manager import HistoryManager

router = APIRouter()
history_manager = HistoryManager()


@router.get("/history", response_model=List[HistorySummary])
async def list_history():
    """Return lightweight summaries of all saved analyses, newest first."""
    return history_manager.list_all()


@router.get("/history/{history_id}", response_model=HistoryDetail)
async def get_history_detail(history_id: str):
    """Return the full JSON content for a specific analysis."""
    result = history_manager.get_by_id(history_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return result
