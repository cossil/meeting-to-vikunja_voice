from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List

from app.services.glossary_manager import GlossaryManager

router = APIRouter()

# Singleton instance shared across requests
_glossary_manager = GlossaryManager()


class GlossaryTermPayload(BaseModel):
    term: str
    variations: List[str]


class GlossaryBulkPayload(BaseModel):
    data: Dict[str, List[str]]


class DeleteTermPayload(BaseModel):
    term: str


@router.get("/glossary")
async def get_glossary() -> Dict[str, List[str]]:
    """Return the full phonetic glossary."""
    return _glossary_manager.load()


@router.post("/glossary")
async def save_glossary(payload: GlossaryBulkPayload) -> Dict[str, List[str]]:
    """Overwrite the entire glossary with the provided data."""
    if not isinstance(payload.data, dict):
        raise HTTPException(status_code=400, detail="data must be a JSON object")
    _glossary_manager.save(payload.data)
    return _glossary_manager.load()


@router.post("/glossary/term")
async def add_term(payload: GlossaryTermPayload) -> Dict[str, List[str]]:
    """Add or update a single glossary term."""
    if not payload.term.strip():
        raise HTTPException(status_code=400, detail="term must not be empty")
    return _glossary_manager.add_term(payload.term.strip(), payload.variations)


@router.delete("/glossary/term")
async def delete_term(payload: DeleteTermPayload) -> Dict[str, List[str]]:
    """Remove a single glossary term by key."""
    if not payload.term.strip():
        raise HTTPException(status_code=400, detail="term must not be empty")
    return _glossary_manager.remove_term(payload.term.strip())
