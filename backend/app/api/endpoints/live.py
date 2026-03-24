import logging
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from app.core.security import get_current_user, decode_access_token
from app.models.auth_schemas import User
from app.services.live_session import GeminiLiveSession
from app.services.persistence_service import save_conversation
from app.services.user_manager import user_manager
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Model ID must match live_session.py — single source of truth
_LIVE_MODEL_ID = "gemini-2.5-flash-native-audio-preview-12-2025"


async def _authenticate_websocket(websocket: WebSocket) -> User | None:
    """Extract and validate JWT from the 'token' query parameter.
    Returns the User on success, or None on failure (caller should close WS).
    """
    token = websocket.query_params.get("token")
    if not token:
        logger.warning("WebSocket connection missing 'token' query parameter")
        return None
    try:
        payload = decode_access_token(token)
        username = payload.get("sub")
        if not username:
            logger.warning("WebSocket JWT missing 'sub' claim")
            return None
        user = user_manager.get_user(username)
        if user is None or not user.is_active:
            logger.warning("WebSocket JWT refers to invalid/inactive user: %s", username)
            return None
        return user
    except Exception:
        logger.warning("WebSocket JWT validation failed", exc_info=True)
        return None


@router.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    user = await _authenticate_websocket(websocket)
    if user is None:
        await websocket.close(code=1008, reason="Authentication required")
        return
    session = GeminiLiveSession(user=user)
    await session.start(websocket)


@router.post("/live/save", response_model=SaveConversationResponse)
async def save_live_conversation(request: SaveConversationRequest, current_user: User = Depends(get_current_user)):
    """
    Save a Live Agent conversation log.
    If sync_to_vikunja=True, also create the task in Vikunja.
    """
    return await save_conversation(
        request,
        agent_type="live",
        agent_version=_LIVE_MODEL_ID,
        user_id=current_user.id,
    )
