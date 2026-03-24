import logging

from fastapi import APIRouter, HTTPException, status, Depends

from app.core.security import create_access_token, get_current_user
from app.models.auth_schemas import (
    TokenResponse,
    User,
    UserLogin,
    UserPublic,
)
from app.services.user_manager import user_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(payload: UserLogin):
    """Authenticate a user and return a JWT access token."""
    user = user_manager.get_user(payload.username)

    if user is None or not user_manager.verify_password(payload.password, user.hashed_password):
        logger.warning("Failed login attempt for username: %s", payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    token = create_access_token({"sub": user.username, "role": user.role})

    return TokenResponse(
        access_token=token,
        user=UserPublic(
            id=user.id,
            username=user.username,
            role=user.role,
            created_at=user.created_at,
            is_active=user.is_active,
        ),
    )


@router.get("/me", response_model=UserPublic)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's public profile."""
    return UserPublic(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        created_at=current_user.created_at,
        is_active=current_user.is_active,
    )
