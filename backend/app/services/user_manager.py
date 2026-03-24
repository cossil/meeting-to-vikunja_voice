import json
import logging
import uuid
from datetime import datetime
from pathlib import Path

import bcrypt

from app.core.config import settings
from app.models.auth_schemas import User, UserCreate, UserUpdate

logger = logging.getLogger(__name__)


class UserManager:
    """Manages user CRUD operations with bcrypt hashing and JSON file persistence."""

    USERS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "users.json"

    # ------------------------------------------------------------------
    # Password helpers
    # ------------------------------------------------------------------

    @staticmethod
    def hash_password(plain: str) -> str:
        """Hash a plain-text password with bcrypt."""
        return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        """Verify a plain-text password against a bcrypt hash."""
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load_users(self) -> list[dict]:
        """Load the raw user list from disk. Returns [] if file missing/corrupt."""
        if not self.USERS_FILE.exists():
            return []
        try:
            data = json.loads(self.USERS_FILE.read_text(encoding="utf-8"))
            assert isinstance(data, list)
            return data
        except Exception:
            logger.error("Failed to load users.json", exc_info=True)
            return []

    def _save_users(self, users: list[dict]) -> None:
        """Atomically write the user list to disk."""
        self.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.USERS_FILE.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(users, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # os.replace is atomic and works on Windows (unlike Path.rename when target exists)
        import os
        os.replace(tmp, self.USERS_FILE)

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def get_user(self, username: str) -> User | None:
        """Look up a user by username. Returns None if not found."""
        for raw in self._load_users():
            if raw.get("username") == username:
                return User(**raw)
        return None

    def get_user_by_id(self, user_id: str) -> User | None:
        """Look up a user by id. Returns None if not found."""
        for raw in self._load_users():
            if raw.get("id") == user_id:
                return User(**raw)
        return None

    def list_users(self) -> list[User]:
        """Return all users."""
        return [User(**raw) for raw in self._load_users()]

    def create_user(self, payload: UserCreate) -> User:
        """
        Create a new user. Raises ValueError if the username already exists.
        The password is hashed before storage — plain text is never persisted.
        """
        users = self._load_users()

        if any(u["username"] == payload.username for u in users):
            raise ValueError(f"Username '{payload.username}' already exists")

        user = User(
            id=str(uuid.uuid4()),
            username=payload.username,
            hashed_password=self.hash_password(payload.password),
            role=payload.role,
            is_active=True,
            created_at=datetime.now().isoformat(),
        )

        users.append(user.model_dump())
        self._save_users(users)
        logger.info("User created: %s (role=%s)", user.username, user.role)
        return user

    def update_user(self, user_id: str, payload: UserUpdate) -> User | None:
        """
        Partially update a user by ID. Only non-None fields are applied.
        Returns the updated User, or None if not found.
        """
        users = self._load_users()
        for raw in users:
            if raw.get("id") == user_id:
                updates = payload.model_dump(exclude_none=True)
                raw.update(updates)
                self._save_users(users)
                logger.info("User updated: %s fields=%s", user_id, list(updates.keys()))
                return User(**raw)
        return None

    def reset_password(self, user_id: str, new_password: str) -> bool:
        """Set a new hashed password for the user. Returns False if not found."""
        users = self._load_users()
        for raw in users:
            if raw.get("id") == user_id:
                raw["hashed_password"] = self.hash_password(new_password)
                self._save_users(users)
                logger.info("Password reset for user: %s", user_id)
                return True
        return False

    def delete_user(self, username: str) -> bool:
        """Delete a user by username. Returns True if removed, False if not found."""
        users = self._load_users()
        filtered = [u for u in users if u["username"] != username]
        if len(filtered) == len(users):
            return False
        self._save_users(filtered)
        logger.info("User deleted: %s", username)
        return True

    def delete_user_by_id(self, user_id: str) -> bool:
        """Delete a user by ID. Returns True if removed, False if not found."""
        users = self._load_users()
        filtered = [u for u in users if u.get("id") != user_id]
        if len(filtered) == len(users):
            return False
        self._save_users(filtered)
        logger.info("User deleted by id: %s", user_id)
        return True

    # ------------------------------------------------------------------
    # Startup bootstrap
    # ------------------------------------------------------------------

    def ensure_admin_exists(self) -> None:
        """
        Called on application startup. If no users exist, create the default
        admin account from environment settings.
        """
        users = self._load_users()
        if users:
            logger.info("Users file present with %d user(s) — skipping bootstrap.", len(users))
            return

        admin_payload = UserCreate(
            username=settings.DEFAULT_ADMIN_USERNAME,
            password=settings.DEFAULT_ADMIN_PASSWORD,
            role="admin",
        )
        self.create_user(admin_payload)
        logger.info(
            "Default admin user '%s' created. Change the password immediately!",
            settings.DEFAULT_ADMIN_USERNAME,
        )


# Module-level singleton — imported by security.py and endpoints
user_manager = UserManager()
