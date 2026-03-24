"""
Tests for Phase 11d: Admin User Management Endpoints.

Covers:
  - GET /admin/users (list)
  - POST /admin/users (create, duplicate handling)
  - PUT /admin/users/{id} (update role / is_active)
  - DELETE /admin/users/{id}
  - POST /admin/users/{id}/reset-password
  - 403 for non-admin users
  - UserManager.update_user / reset_password / delete_user_by_id
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.auth_schemas import UserCreate, UserUpdate
from app.services.user_manager import UserManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_manager(tmp_path):
    mgr = UserManager()
    mgr.USERS_FILE = tmp_path / "users.json"
    return mgr


@pytest.fixture()
def seeded_manager(tmp_manager):
    mgr = tmp_manager
    mgr.create_user(UserCreate(username="admin_boss", password="Adm1nP@ss!", role="admin"))
    mgr.create_user(UserCreate(username="regular_joe", password="Us3rP@ss!!", role="user"))
    return mgr


@pytest.fixture()
def admin_client(seeded_manager):
    """TestClient authenticated as admin."""
    mgr = seeded_manager
    with patch("app.services.user_manager.user_manager", mgr), \
         patch("app.api.endpoints.auth.user_manager", mgr), \
         patch("app.api.endpoints.admin.user_manager", mgr):
        from app.main import app
        client = TestClient(app)
        # Login as admin
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin_boss", "password": "Adm1nP@ss!",
        })
        token = resp.json()["access_token"]
        client.headers.update({"Authorization": f"Bearer {token}"})
        yield client, mgr


@pytest.fixture()
def user_client(seeded_manager):
    """TestClient authenticated as a regular user."""
    mgr = seeded_manager
    with patch("app.services.user_manager.user_manager", mgr), \
         patch("app.api.endpoints.auth.user_manager", mgr), \
         patch("app.api.endpoints.admin.user_manager", mgr):
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/auth/login", json={
            "username": "regular_joe", "password": "Us3rP@ss!!",
        })
        token = resp.json()["access_token"]
        client.headers.update({"Authorization": f"Bearer {token}"})
        yield client, mgr


# ---------------------------------------------------------------------------
# UserManager unit tests for new methods
# ---------------------------------------------------------------------------

class TestUserManagerNewMethods:
    def test_update_user_role(self, seeded_manager):
        user = seeded_manager.get_user("regular_joe")
        updated = seeded_manager.update_user(user.id, UserUpdate(role="admin"))
        assert updated is not None
        assert updated.role == "admin"
        # Verify persistence
        reloaded = seeded_manager.get_user_by_id(user.id)
        assert reloaded.role == "admin"

    def test_update_user_is_active(self, seeded_manager):
        user = seeded_manager.get_user("regular_joe")
        updated = seeded_manager.update_user(user.id, UserUpdate(is_active=False))
        assert updated is not None
        assert updated.is_active is False

    def test_update_user_not_found(self, seeded_manager):
        result = seeded_manager.update_user("nonexistent-id", UserUpdate(role="admin"))
        assert result is None

    def test_reset_password(self, seeded_manager):
        user = seeded_manager.get_user("regular_joe")
        assert seeded_manager.reset_password(user.id, "N3wP@ssword!") is True
        # Verify the new password works
        reloaded = seeded_manager.get_user_by_id(user.id)
        assert UserManager.verify_password("N3wP@ssword!", reloaded.hashed_password)

    def test_reset_password_not_found(self, seeded_manager):
        assert seeded_manager.reset_password("ghost-id", "whatever1") is False

    def test_delete_user_by_id(self, seeded_manager):
        user = seeded_manager.get_user("regular_joe")
        assert seeded_manager.delete_user_by_id(user.id) is True
        assert seeded_manager.get_user_by_id(user.id) is None

    def test_delete_user_by_id_not_found(self, seeded_manager):
        assert seeded_manager.delete_user_by_id("no-such-id") is False


# ---------------------------------------------------------------------------
# Admin endpoint integration tests
# ---------------------------------------------------------------------------

class TestAdminListUsers:
    def test_list_users(self, admin_client):
        client, _ = admin_client
        resp = client.get("/api/v1/admin/users")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        usernames = {u["username"] for u in data}
        assert usernames == {"admin_boss", "regular_joe"}
        # Ensure no password hashes leak
        for u in data:
            assert "hashed_password" not in u


class TestAdminCreateUser:
    def test_create_user_success(self, admin_client):
        client, _ = admin_client
        resp = client.post("/api/v1/admin/users", json={
            "username": "new_hire", "password": "H1r3P@ss!", "role": "user",
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["username"] == "new_hire"
        assert body["role"] == "user"
        assert body["is_active"] is True
        assert "hashed_password" not in body

    def test_create_duplicate_returns_409(self, admin_client):
        client, _ = admin_client
        resp = client.post("/api/v1/admin/users", json={
            "username": "admin_boss", "password": "An0therPW!", "role": "user",
        })
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]


class TestAdminUpdateUser:
    def test_update_role(self, admin_client):
        client, mgr = admin_client
        user = mgr.get_user("regular_joe")
        resp = client.put(f"/api/v1/admin/users/{user.id}", json={"role": "admin"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"

    def test_update_is_active(self, admin_client):
        client, mgr = admin_client
        user = mgr.get_user("regular_joe")
        resp = client.put(f"/api/v1/admin/users/{user.id}", json={"is_active": False})
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_update_not_found(self, admin_client):
        client, _ = admin_client
        resp = client.put("/api/v1/admin/users/fake-id", json={"role": "admin"})
        assert resp.status_code == 404


class TestAdminDeleteUser:
    def test_delete_user(self, admin_client):
        client, mgr = admin_client
        user = mgr.get_user("regular_joe")
        resp = client.delete(f"/api/v1/admin/users/{user.id}")
        assert resp.status_code == 204
        assert mgr.get_user("regular_joe") is None

    def test_delete_not_found(self, admin_client):
        client, _ = admin_client
        resp = client.delete("/api/v1/admin/users/fake-id")
        assert resp.status_code == 404


class TestAdminResetPassword:
    def test_reset_password_success(self, admin_client):
        client, mgr = admin_client
        user = mgr.get_user("regular_joe")
        resp = client.post(f"/api/v1/admin/users/{user.id}/reset-password", json={
            "new_password": "R3s3tP@ss!",
        })
        assert resp.status_code == 200
        # Verify the new password actually works
        reloaded = mgr.get_user_by_id(user.id)
        assert UserManager.verify_password("R3s3tP@ss!", reloaded.hashed_password)

    def test_reset_password_not_found(self, admin_client):
        client, _ = admin_client
        resp = client.post("/api/v1/admin/users/fake-id/reset-password", json={
            "new_password": "Whatever1!",
        })
        assert resp.status_code == 404

    def test_reset_password_too_short(self, admin_client):
        client, mgr = admin_client
        user = mgr.get_user("regular_joe")
        resp = client.post(f"/api/v1/admin/users/{user.id}/reset-password", json={
            "new_password": "short",
        })
        assert resp.status_code == 422  # Pydantic validation


# ---------------------------------------------------------------------------
# Authorization: non-admin must get 403
# ---------------------------------------------------------------------------

class TestNonAdminForbidden:
    def test_list_forbidden(self, user_client):
        client, _ = user_client
        resp = client.get("/api/v1/admin/users")
        assert resp.status_code == 403

    def test_create_forbidden(self, user_client):
        client, _ = user_client
        resp = client.post("/api/v1/admin/users", json={
            "username": "sneaky", "password": "Sn3@kyPW!", "role": "admin",
        })
        assert resp.status_code == 403

    def test_update_forbidden(self, user_client):
        client, _ = user_client
        resp = client.put("/api/v1/admin/users/any-id", json={"role": "admin"})
        assert resp.status_code == 403

    def test_delete_forbidden(self, user_client):
        client, _ = user_client
        resp = client.delete("/api/v1/admin/users/any-id")
        assert resp.status_code == 403

    def test_reset_password_forbidden(self, user_client):
        client, _ = user_client
        resp = client.post("/api/v1/admin/users/any-id/reset-password", json={
            "new_password": "W@ntAdm1n!",
        })
        assert resp.status_code == 403
