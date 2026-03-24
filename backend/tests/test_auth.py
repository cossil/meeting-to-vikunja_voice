"""
Tests for Phase 11a: Authentication & User Management Foundation.

Covers:
  - Password hashing & verification (bcrypt)
  - JWT encoding & decoding
  - UserManager CRUD and ensure_admin_exists()
  - Auth endpoint /auth/login
"""

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import jwt
import pytest
from fastapi.testclient import TestClient

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token
from app.models.auth_schemas import User, UserCreate
from app.services.user_manager import UserManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_users_file(tmp_path):
    """Provide a UserManager that writes to a temporary users.json."""
    mgr = UserManager()
    mgr.USERS_FILE = tmp_path / "users.json"
    return mgr


@pytest.fixture()
def seeded_manager(tmp_users_file):
    """UserManager with one admin and one regular user already created."""
    mgr = tmp_users_file
    mgr.create_user(UserCreate(username="admin_test", password="Str0ngP@ss", role="admin"))
    mgr.create_user(UserCreate(username="regular_user", password="Us3rP@ss!", role="user"))
    return mgr


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        hashed = UserManager.hash_password("my_secret")
        assert hashed != "my_secret"

    def test_verify_correct_password(self):
        hashed = UserManager.hash_password("correct_horse")
        assert UserManager.verify_password("correct_horse", hashed) is True

    def test_verify_wrong_password(self):
        hashed = UserManager.hash_password("correct_horse")
        assert UserManager.verify_password("wrong_horse", hashed) is False

    def test_hash_uniqueness(self):
        h1 = UserManager.hash_password("same_pw")
        h2 = UserManager.hash_password("same_pw")
        # bcrypt salts should make hashes different
        assert h1 != h2

    def test_hash_starts_with_bcrypt_prefix(self):
        hashed = UserManager.hash_password("test123!")
        assert hashed.startswith("$2b$")


# ---------------------------------------------------------------------------
# JWT encode / decode
# ---------------------------------------------------------------------------

class TestJWT:
    def test_roundtrip(self):
        token = create_access_token({"sub": "alice", "role": "admin"})
        payload = decode_access_token(token)
        assert payload["sub"] == "alice"
        assert payload["role"] == "admin"
        assert "exp" in payload

    def test_expired_token_raises(self):
        payload = {
            "sub": "alice",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        with pytest.raises(Exception) as exc_info:
            decode_access_token(token)
        assert exc_info.value.status_code == 401

    def test_invalid_token_raises(self):
        with pytest.raises(Exception) as exc_info:
            decode_access_token("this.is.garbage")
        assert exc_info.value.status_code == 401

    def test_tampered_token_raises(self):
        token = create_access_token({"sub": "bob"})
        tampered = token[:-4] + "XXXX"
        with pytest.raises(Exception) as exc_info:
            decode_access_token(tampered)
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# UserManager CRUD
# ---------------------------------------------------------------------------

class TestUserManager:
    def test_create_user(self, tmp_users_file):
        mgr = tmp_users_file
        user = mgr.create_user(UserCreate(username="newuser", password="P@ssw0rd!", role="user"))
        assert user.username == "newuser"
        assert user.role == "user"
        assert user.is_active is True
        # Password must be hashed, not plain
        assert user.hashed_password != "P@ssw0rd!"

    def test_get_user(self, seeded_manager):
        user = seeded_manager.get_user("admin_test")
        assert user is not None
        assert user.role == "admin"

    def test_get_user_not_found(self, seeded_manager):
        assert seeded_manager.get_user("nonexistent") is None

    def test_get_user_by_id(self, seeded_manager):
        admin = seeded_manager.get_user("admin_test")
        found = seeded_manager.get_user_by_id(admin.id)
        assert found is not None
        assert found.username == "admin_test"

    def test_list_users(self, seeded_manager):
        users = seeded_manager.list_users()
        assert len(users) == 2
        usernames = {u.username for u in users}
        assert usernames == {"admin_test", "regular_user"}

    def test_duplicate_username_raises(self, seeded_manager):
        with pytest.raises(ValueError, match="already exists"):
            seeded_manager.create_user(UserCreate(username="admin_test", password="AnotherPW1!", role="user"))

    def test_delete_user(self, seeded_manager):
        assert seeded_manager.delete_user("regular_user") is True
        assert seeded_manager.get_user("regular_user") is None
        assert len(seeded_manager.list_users()) == 1

    def test_delete_nonexistent(self, seeded_manager):
        assert seeded_manager.delete_user("ghost") is False

    def test_persistence(self, tmp_users_file):
        mgr = tmp_users_file
        mgr.create_user(UserCreate(username="persisted", password="T3stP@ss!", role="user"))
        # Create a NEW manager pointing at the same file
        mgr2 = UserManager()
        mgr2.USERS_FILE = mgr.USERS_FILE
        assert mgr2.get_user("persisted") is not None

    def test_passwords_never_stored_plain(self, tmp_users_file):
        mgr = tmp_users_file
        mgr.create_user(UserCreate(username="secretive", password="MyS3cret!", role="user"))
        raw = json.loads(mgr.USERS_FILE.read_text(encoding="utf-8"))
        for entry in raw:
            assert "password" not in entry  # no plain 'password' field
            assert entry.get("hashed_password", "").startswith("$2b$")


# ---------------------------------------------------------------------------
# ensure_admin_exists()
# ---------------------------------------------------------------------------

class TestEnsureAdmin:
    def test_creates_admin_when_no_users(self, tmp_users_file):
        mgr = tmp_users_file
        mgr.ensure_admin_exists()
        admin = mgr.get_user(settings.DEFAULT_ADMIN_USERNAME)
        assert admin is not None
        assert admin.role == "admin"

    def test_skips_when_users_exist(self, seeded_manager):
        count_before = len(seeded_manager.list_users())
        seeded_manager.ensure_admin_exists()
        assert len(seeded_manager.list_users()) == count_before


# ---------------------------------------------------------------------------
# Auth endpoint integration tests
# ---------------------------------------------------------------------------

class TestAuthEndpoints:
    @pytest.fixture(autouse=True)
    def _setup_app(self, tmp_users_file):
        """Patch user_manager globally so the app uses the temp file."""
        mgr = tmp_users_file
        mgr.create_user(UserCreate(username="testadmin", password="Adm1nP@ss", role="admin"))

        # security.py lazy-imports user_manager at call time, so we patch the singleton
        # on the module where it's defined; auth.py imports it directly at module level.
        with patch("app.services.user_manager.user_manager", mgr), \
             patch("app.api.endpoints.auth.user_manager", mgr):
            from app.main import app
            self.client = TestClient(app)
            self.mgr = mgr
            yield

    def test_login_success(self):
        resp = self.client.post("/api/v1/auth/login", json={
            "username": "testadmin",
            "password": "Adm1nP@ss",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert body["user"]["username"] == "testadmin"
        assert body["user"]["role"] == "admin"
        # Ensure no hash leaks into public response
        assert "hashed_password" not in body["user"]

    def test_login_wrong_password(self):
        resp = self.client.post("/api/v1/auth/login", json={
            "username": "testadmin",
            "password": "WrongPassword1",
        })
        assert resp.status_code == 401

    def test_login_unknown_user(self):
        resp = self.client.post("/api/v1/auth/login", json={
            "username": "nobody",
            "password": "whatever1",
        })
        assert resp.status_code == 401

    def test_me_endpoint(self):
        # Login first
        login_resp = self.client.post("/api/v1/auth/login", json={
            "username": "testadmin",
            "password": "Adm1nP@ss",
        })
        token = login_resp.json()["access_token"]

        # Fetch /me
        me_resp = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me_resp.status_code == 200
        assert me_resp.json()["username"] == "testadmin"

    def test_me_without_token(self):
        resp = self.client.get("/api/v1/auth/me")
        assert resp.status_code == 403  # HTTPBearer returns 403 when header missing
