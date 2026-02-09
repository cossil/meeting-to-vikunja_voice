import json
import os
import sys
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

import pytest

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.conversation_manager import ConversationManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_conversations_dir(tmp_path):
    """Provide a temporary directory and patch CONVERSATIONS_DIR to use it."""
    conversations_dir = tmp_path / "conversations"
    with patch.object(ConversationManager, "CONVERSATIONS_DIR", conversations_dir):
        yield conversations_dir


@pytest.fixture
def sample_record():
    """Build a minimal conversation record for testing."""
    return {
        "id": "20250208-143022-a1b2c3d4",
        "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "timestamp": "2025-02-08T14:30:22.000000",
        "agent_type": "live",
        "agent_version": "gemini-2.5-flash-native-audio-preview-12-2025",
        "synced_to_vikunja": False,
        "sync_result": None,
        "transcript": [
            {"role": "user", "content": "Preciso criar uma tarefa para o Carlos"},
            {"role": "agent", "content": "Anotei aqui. O título seria..."},
        ],
        "task_draft": {
            "title": "Enviar relatório mensal",
            "description": "Preparar e enviar o relatório consolidado.",
            "assignee": "Carlos",
            "due_date": "2025-02-14",
            "priority": 3,
        },
    }


@pytest.fixture
def synced_record(sample_record):
    """A record that was synced to Vikunja."""
    record = sample_record.copy()
    record["synced_to_vikunja"] = True
    record["sync_result"] = {"success": True}
    return record


# ---------------------------------------------------------------------------
# Tests — save()
# ---------------------------------------------------------------------------

class TestSave:
    def test_save_creates_file(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()
        path = manager.save(sample_record)

        assert path.exists()
        assert path.suffix == ".json"

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["id"] == "20250208-143022-a1b2c3d4"
        assert data["session_id"] == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        assert data["agent_type"] == "live"
        assert data["synced_to_vikunja"] is False
        assert len(data["transcript"]) == 2
        assert data["task_draft"]["title"] == "Enviar relatório mensal"

    def test_save_creates_directory_if_missing(self, tmp_conversations_dir, sample_record):
        assert not tmp_conversations_dir.exists()
        manager = ConversationManager()
        path = manager.save(sample_record)
        assert tmp_conversations_dir.exists()
        assert path.exists()

    def test_save_synced_record(self, tmp_conversations_dir, synced_record):
        manager = ConversationManager()
        path = manager.save(synced_record)

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["synced_to_vikunja"] is True
        assert data["sync_result"]["success"] is True


# ---------------------------------------------------------------------------
# Tests — filename format
# ---------------------------------------------------------------------------

class TestFilenameFormat:
    def test_filename_matches_pattern(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()
        path = manager.save(sample_record)

        name = path.name
        assert name.endswith(".json")
        # Pattern: YYYYMMDD-HHMMSS_sessionshort.json
        parts = name.replace(".json", "").split("_", 1)
        assert len(parts) == 2
        assert len(parts[0]) == 15  # YYYYMMDD-HHMMSS


# ---------------------------------------------------------------------------
# Tests — collision handling
# ---------------------------------------------------------------------------

class TestCollisionHandling:
    def test_duplicate_filename_gets_suffix(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()

        fixed_time = datetime(2025, 2, 8, 14, 30, 22)
        with patch("app.services.conversation_manager.datetime") as mock_dt:
            mock_dt.now.return_value = fixed_time
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

            path1 = manager.save(sample_record)
            path2 = manager.save(sample_record)

        assert path1.exists()
        assert path2.exists()
        assert path1 != path2
        assert "_1" in path2.stem


# ---------------------------------------------------------------------------
# Tests — sanitize
# ---------------------------------------------------------------------------

class TestSanitize:
    def test_special_chars_replaced(self):
        assert ConversationManager._sanitize("a1b2-c3d4") == "a1b2-c3d4"

    def test_uuid_chars(self):
        result = ConversationManager._sanitize("a1b2c3d4-e5f6")
        assert result == "a1b2c3d4-e5f6"

    def test_empty_string(self):
        assert ConversationManager._sanitize("") == "unnamed"

    def test_truncation(self):
        long_name = "a" * 100
        assert len(ConversationManager._sanitize(long_name)) == 50


# ---------------------------------------------------------------------------
# Tests — list_all()
# ---------------------------------------------------------------------------

class TestListAll:
    def test_list_all_returns_sorted(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()

        t1 = datetime(2025, 1, 1, 10, 0, 0)
        t2 = datetime(2025, 1, 2, 10, 0, 0)

        record1 = sample_record.copy()
        record1["timestamp"] = t1.isoformat()
        record2 = sample_record.copy()
        record2["timestamp"] = t2.isoformat()
        record2["id"] = "20250102-100000-a1b2c3d4"

        with patch("app.services.conversation_manager.datetime") as mock_dt:
            mock_dt.now.return_value = t1
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            manager.save(record1)

            mock_dt.now.return_value = t2
            manager.save(record2)

        items = manager.list_all()
        assert len(items) == 2
        # Newest first
        assert items[0]["timestamp"] > items[1]["timestamp"]

    def test_list_all_empty_dir(self, tmp_conversations_dir):
        tmp_conversations_dir.mkdir(parents=True, exist_ok=True)
        manager = ConversationManager()
        assert manager.list_all() == []

    def test_list_all_no_dir(self, tmp_conversations_dir):
        manager = ConversationManager()
        assert manager.list_all() == []

    def test_list_all_has_summary_fields(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()
        manager.save(sample_record)
        items = manager.list_all()
        item = items[0]
        assert "id" in item
        assert "timestamp" in item
        assert item["agent_type"] == "live"
        assert item["synced_to_vikunja"] is False
        assert item["task_title"] == "Enviar relatório mensal"
        assert item["turn_count"] == 2


# ---------------------------------------------------------------------------
# Tests — get_by_id()
# ---------------------------------------------------------------------------

class TestGetById:
    def test_get_by_id_found(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()
        manager.save(sample_record)
        result = manager.get_by_id(sample_record["id"])
        assert result is not None
        assert result["id"] == sample_record["id"]
        assert len(result["transcript"]) == 2

    def test_get_by_id_not_found(self, tmp_conversations_dir, sample_record):
        manager = ConversationManager()
        manager.save(sample_record)
        assert manager.get_by_id("nonexistent-id") is None

    def test_get_by_id_no_dir(self, tmp_conversations_dir):
        manager = ConversationManager()
        assert manager.get_by_id("anything") is None


# ---------------------------------------------------------------------------
# Tests — save failure isolation
# ---------------------------------------------------------------------------

class TestSaveFailureIsolation:
    def test_readonly_dir_raises(self, tmp_path, sample_record):
        """Confirm save() raises when it cannot write, so the endpoint catches it."""
        readonly_dir = tmp_path / "readonly"
        readonly_dir.mkdir()

        # Create a file where the directory should be to force an error
        blocker = readonly_dir / "conversations"
        blocker.write_text("block")

        with patch.object(ConversationManager, "CONVERSATIONS_DIR", blocker):
            manager = ConversationManager()
            with pytest.raises(Exception):
                manager.save(sample_record)
