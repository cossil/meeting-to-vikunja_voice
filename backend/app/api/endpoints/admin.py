"""
Admin-only endpoints for user management.

Every route in this module requires the ``require_admin`` dependency,
which ensures only authenticated admins (role='admin') can access them.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import require_admin
from app.models.auth_schemas import (
    PasswordReset,
    User,
    UserCreate,
    UserPublic,
    UserUpdate,
)
from app.services.user_manager import user_manager

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_admin)])


def _to_public(user: User) -> UserPublic:
    """Convert an internal User model to the public-facing schema."""
    return UserPublic(
        id=user.id,
        username=user.username,
        role=user.role,
        created_at=user.created_at,
        is_active=user.is_active,
    )


# -----------------------------------------------------------------------
# LIST
# -----------------------------------------------------------------------

@router.get("/users", response_model=list[UserPublic])
async def list_users():
    """Return all users (public fields only)."""
    return [_to_public(u) for u in user_manager.list_users()]


# -----------------------------------------------------------------------
# CREATE
# -----------------------------------------------------------------------

@router.post("/users", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate):
    """Create a new user account."""
    try:
        user = user_manager.create_user(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    return _to_public(user)


# -----------------------------------------------------------------------
# UPDATE
# -----------------------------------------------------------------------

@router.put("/users/{user_id}", response_model=UserPublic)
async def update_user(user_id: str, payload: UserUpdate):
    """Update a user's role and/or active status."""
    updated = user_manager.update_user(user_id, payload)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _to_public(updated)


# -----------------------------------------------------------------------
# DELETE
# -----------------------------------------------------------------------

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: str):
    """Hard-delete a user by ID."""
    if not user_manager.delete_user_by_id(user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )


# -----------------------------------------------------------------------
# RESET PASSWORD
# -----------------------------------------------------------------------

@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(user_id: str, payload: PasswordReset):
    """Allow an admin to set a new password for any user."""
    if not user_manager.reset_password(user_id, payload.new_password):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return {"detail": "Password reset successfully"}
