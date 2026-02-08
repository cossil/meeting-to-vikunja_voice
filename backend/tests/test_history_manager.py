import json
import os
import sys
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

import pytest

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.schemas import AnalysisResponse, TaskBase
from app.services.history_manager import HistoryManager


@pytest.fixture
def tmp_history_dir(tmp_path):
    """Provide a temporary directory and patch HISTORY_DIR to use it."""
    history_dir = tmp_path / "history"
    with patch.object(HistoryManager, "HISTORY_DIR", history_dir):
        yield history_dir


@pytest.fixture
def sample_response():
    """Build a minimal AnalysisResponse for testing."""
    return AnalysisResponse(
        tasks=[
            TaskBase(
                title="Enviar relatório mensal",
                description="Preparar e enviar o relatório consolidado.",
                assignee_name="Carlos",
                priority=3,
                due_date="2025-02-14",
            )
        ],
        token_count=1842,
        processing_time=3.21,
        file_count=1,
        file_names=["ata_reuniao_semanal.txt"],
    )


@pytest.fixture
def multi_file_response():
    """AnalysisResponse with multiple source files."""
    return AnalysisResponse(
        tasks=[TaskBase(title="Tarefa A", priority=1)],
        token_count=500,
        processing_time=1.0,
        file_count=3,
        file_names=["part1.txt", "part2.txt", "part3.txt"],
    )


# --- Unit Tests ---

class TestSaveCreatesFile:
    def test_save_creates_file(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        path = manager.save(sample_response)

        assert path.exists()
        assert path.suffix == ".json"

        data = json.loads(path.read_text(encoding="utf-8"))
        assert "id" in data
        assert "timestamp" in data
        assert data["source_files"] == ["ata_reuniao_semanal.txt"]
        assert data["file_count"] == 1
        assert data["model_used"] == "gemini-3-flash-preview"
        assert data["token_count"] == 1842
        assert len(data["analysis"]["tasks"]) == 1
        assert data["analysis"]["tasks"][0]["title"] == "Enviar relatório mensal"

    def test_save_creates_directory_if_missing(self, tmp_history_dir, sample_response):
        assert not tmp_history_dir.exists()
        manager = HistoryManager()
        path = manager.save(sample_response)
        assert tmp_history_dir.exists()
        assert path.exists()


class TestFilenameFormat:
    def test_filename_matches_pattern(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        path = manager.save(sample_response)

        # Pattern: YYYYMMDD-HHMMSS_name.json
        name = path.name
        assert name.endswith(".json")
        parts = name.replace(".json", "").split("_", 1)
        assert len(parts) == 2
        # Timestamp part: YYYYMMDD-HHMMSS
        assert len(parts[0]) == 15  # 8 digits + dash + 6 digits

    def test_multi_file_naming(self, tmp_history_dir, multi_file_response):
        manager = HistoryManager()
        path = manager.save(multi_file_response)
        assert "multi_3_files" in path.name


class TestSanitize:
    def test_special_chars_replaced(self):
        assert HistoryManager._sanitize("ata reunião (v2)") == "ata_reuni_o_v2"

    def test_slashes_replaced(self):
        assert HistoryManager._sanitize("path/to/file") == "path_to_file"

    def test_truncation(self):
        long_name = "a" * 100
        assert len(HistoryManager._sanitize(long_name)) == 50

    def test_empty_string(self):
        assert HistoryManager._sanitize("") == "unnamed"

    def test_only_special_chars(self):
        assert HistoryManager._sanitize("!!!") == "unnamed"


class TestCollisionHandling:
    def test_duplicate_filename_gets_suffix(self, tmp_history_dir, sample_response):
        manager = HistoryManager()

        # Freeze time so both calls produce the same timestamp
        fixed_time = datetime(2025, 2, 7, 16, 15, 23)
        with patch("app.services.history_manager.datetime") as mock_dt:
            mock_dt.now.return_value = fixed_time
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

            path1 = manager.save(sample_response)
            path2 = manager.save(sample_response)

        assert path1.exists()
        assert path2.exists()
        assert path1 != path2
        assert "_1" in path2.stem


class TestCustomModel:
    def test_model_used_is_recorded(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        path = manager.save(sample_response, model_used="gemini-2.0-flash")
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["model_used"] == "gemini-2.0-flash"


class TestListAll:
    def test_list_all_returns_sorted(self, tmp_history_dir, sample_response):
        manager = HistoryManager()

        t1 = datetime(2025, 1, 1, 10, 0, 0)
        t2 = datetime(2025, 1, 2, 10, 0, 0)
        with patch("app.services.history_manager.datetime") as mock_dt:
            mock_dt.now.return_value = t1
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            manager.save(sample_response)

            mock_dt.now.return_value = t2
            manager.save(sample_response)

        items = manager.list_all()
        assert len(items) == 2
        # Newest first
        assert items[0]["timestamp"] > items[1]["timestamp"]

    def test_list_all_empty_dir(self, tmp_history_dir):
        tmp_history_dir.mkdir(parents=True, exist_ok=True)
        manager = HistoryManager()
        assert manager.list_all() == []

    def test_list_all_no_dir(self, tmp_history_dir):
        manager = HistoryManager()
        assert manager.list_all() == []

    def test_list_all_has_task_count(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        manager.save(sample_response)
        items = manager.list_all()
        assert items[0]["task_count"] == 1


class TestGetById:
    def test_get_by_id_found(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        path = manager.save(sample_response)
        saved = json.loads(path.read_text(encoding="utf-8"))
        result = manager.get_by_id(saved["id"])
        assert result is not None
        assert result["id"] == saved["id"]
        assert len(result["analysis"]["tasks"]) == 1

    def test_get_by_id_not_found(self, tmp_history_dir, sample_response):
        manager = HistoryManager()
        manager.save(sample_response)
        assert manager.get_by_id("nonexistent-id") is None

    def test_get_by_id_no_dir(self, tmp_history_dir):
        manager = HistoryManager()
        assert manager.get_by_id("anything") is None


class TestSaveFailureIsolation:
    def test_readonly_dir_raises(self, tmp_path, sample_response):
        """Confirm save() raises when it cannot write, so batch.py's try/except catches it."""
        readonly_dir = tmp_path / "readonly"
        readonly_dir.mkdir()

        # Create a file where the directory should be to force an error
        blocker = readonly_dir / "history"
        blocker.write_text("block")

        with patch.object(HistoryManager, "HISTORY_DIR", blocker):
            manager = HistoryManager()
            with pytest.raises(Exception):
                manager.save(sample_response)
