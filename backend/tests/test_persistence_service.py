import os
import sys
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.persistence_service import (
    save_conversation,
    _map_draft_to_task,
    _extract_sync_error,
)
from app.services.conversation_manager import ConversationManager
from app.models.schemas import (
    SaveConversationRequest,
    SaveConversationResponse,
    ConversationTaskDraft,
    ConversationTurn,
    TaskBase,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_cm(tmp_path):
    """ConversationManager that writes to a temp directory."""
    cm = ConversationManager()
    conversations_dir = tmp_path / "conversations"
    with patch.object(ConversationManager, "CONVERSATIONS_DIR", conversations_dir):
        yield cm


@pytest.fixture
def mock_vs():
    """VikunjaService mock with async create_task."""
    vs = MagicMock()
    vs.create_task = AsyncMock(return_value=True)
    return vs


@pytest.fixture
def base_request():
    """Minimal SaveConversationRequest for tests."""
    return SaveConversationRequest(
        session_id="a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        transcript=[
            ConversationTurn(role="user", content="Crie uma tarefa para Carlos"),
            ConversationTurn(role="agent", content="Anotado. Qual o prazo?"),
        ],
        task_draft=ConversationTaskDraft(
            title="Enviar relatório mensal",
            description="Preparar e enviar o relatório consolidado.",
            assignee="Carlos",
            due_date="2025-02-14",
            priority=3,
        ),
        sync_to_vikunja=False,
    )


@pytest.fixture
def sync_request(base_request):
    """Request with sync_to_vikunja=True."""
    base_request.sync_to_vikunja = True
    return base_request


# ---------------------------------------------------------------------------
# Tests — _map_draft_to_task
# ---------------------------------------------------------------------------

class TestMapDraftToTask:
    def test_maps_all_fields(self):
        draft = ConversationTaskDraft(
            title="Test task",
            description="Desc",
            assignee="Ana",
            priority=4,
            due_date="2025-03-01",
        )
        task = _map_draft_to_task(draft)

        assert isinstance(task, TaskBase)
        assert task.title == "Test task"
        assert task.description == "Desc"
        assert task.assignee_name == "Ana"
        assert task.priority == 4
        assert task.due_date == "2025-03-01"

    def test_raises_on_none_title(self):
        """TaskBase.title is required; _map_draft_to_task correctly propagates the error.
        In practice the caller guards with `if request.task_draft.title` before calling."""
        from pydantic import ValidationError

        draft = ConversationTaskDraft(title=None)
        with pytest.raises(ValidationError):
            _map_draft_to_task(draft)


# ---------------------------------------------------------------------------
# Tests — _extract_sync_error
# ---------------------------------------------------------------------------

class TestExtractSyncError:
    def test_returns_none_when_no_sync_result(self):
        assert _extract_sync_error({"sync_result": None}) is None

    def test_returns_none_when_success(self):
        assert _extract_sync_error({"sync_result": {"success": True}}) is None

    def test_returns_error_string(self):
        record = {"sync_result": {"success": False, "error": "Connection refused"}}
        assert _extract_sync_error(record) == "Connection refused"

    def test_returns_none_when_key_missing(self):
        assert _extract_sync_error({}) is None


# ---------------------------------------------------------------------------
# Tests — save_conversation: record construction
# ---------------------------------------------------------------------------

class TestRecordConstruction:
    @pytest.mark.asyncio
    async def test_record_fields_standard(self, mock_cm, mock_vs, base_request):
        result = await save_conversation(
            base_request,
            agent_type="standard",
            agent_version="gemini-2.5-flash + gemini-2.5-flash-preview-tts",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert isinstance(result, SaveConversationResponse)
        assert result.saved is True
        assert result.synced is False
        assert result.sync_error is None
        assert "a1b2c3d4" in result.conversation_id

    @pytest.mark.asyncio
    async def test_record_fields_live(self, mock_cm, mock_vs, base_request):
        result = await save_conversation(
            base_request,
            agent_type="live",
            agent_version="gemini-2.5-flash-native-audio-preview-12-2025",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert result.saved is True
        assert result.synced is False

    @pytest.mark.asyncio
    async def test_record_contains_agent_metadata(self, mock_cm, mock_vs, base_request):
        """Verify the persisted JSON has correct agent_type and agent_version."""
        conversations_dir = ConversationManager.CONVERSATIONS_DIR

        await save_conversation(
            base_request,
            agent_type="live",
            agent_version="test-model-v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        # Read the saved file
        files = list(conversations_dir.glob("*.json"))
        assert len(files) == 1
        data = json.loads(files[0].read_text(encoding="utf-8"))

        assert data["agent_type"] == "live"
        assert data["agent_version"] == "test-model-v1"
        assert data["session_id"] == base_request.session_id
        assert len(data["transcript"]) == 2
        assert data["task_draft"]["title"] == "Enviar relatório mensal"


# ---------------------------------------------------------------------------
# Tests — save_conversation: user_id (Phase 11 hook)
# ---------------------------------------------------------------------------

class TestUserIdHook:
    @pytest.mark.asyncio
    async def test_user_id_not_in_record_by_default(self, mock_cm, mock_vs, base_request):
        conversations_dir = ConversationManager.CONVERSATIONS_DIR

        await save_conversation(
            base_request,
            agent_type="standard",
            agent_version="v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        files = list(conversations_dir.glob("*.json"))
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert "owner_id" not in data

    @pytest.mark.asyncio
    async def test_user_id_stored_when_provided(self, mock_cm, mock_vs, base_request):
        conversations_dir = ConversationManager.CONVERSATIONS_DIR

        await save_conversation(
            base_request,
            agent_type="standard",
            agent_version="v1",
            user_id="user-42",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        files = list(conversations_dir.glob("*.json"))
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert data["owner_id"] == "user-42"


# ---------------------------------------------------------------------------
# Tests — save_conversation: Vikunja sync
# ---------------------------------------------------------------------------

class TestVikunjaSync:
    @pytest.mark.asyncio
    async def test_sync_success(self, mock_cm, mock_vs, sync_request):
        mock_vs.create_task = AsyncMock(return_value=True)

        result = await save_conversation(
            sync_request,
            agent_type="live",
            agent_version="v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert result.synced is True
        assert result.sync_error is None
        mock_vs.create_task.assert_called_once()

        # Verify TaskBase was built correctly
        task_arg = mock_vs.create_task.call_args[0][0]
        assert isinstance(task_arg, TaskBase)
        assert task_arg.title == "Enviar relatório mensal"
        assert task_arg.assignee_name == "Carlos"

    @pytest.mark.asyncio
    async def test_sync_failure_captures_error(self, mock_cm, mock_vs, sync_request):
        mock_vs.create_task = AsyncMock(side_effect=ConnectionError("Vikunja unreachable"))

        result = await save_conversation(
            sync_request,
            agent_type="live",
            agent_version="v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert result.saved is True
        assert result.synced is False
        assert result.sync_error == "Vikunja unreachable"

    @pytest.mark.asyncio
    async def test_sync_skipped_when_no_title(self, mock_cm, mock_vs, base_request):
        base_request.sync_to_vikunja = True
        base_request.task_draft.title = None

        result = await save_conversation(
            base_request,
            agent_type="standard",
            agent_version="v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert result.synced is False
        mock_vs.create_task.assert_not_called()

    @pytest.mark.asyncio
    async def test_sync_skipped_when_flag_false(self, mock_cm, mock_vs, base_request):
        base_request.sync_to_vikunja = False

        result = await save_conversation(
            base_request,
            agent_type="standard",
            agent_version="v1",
            conversation_manager=mock_cm,
            vikunja_service=mock_vs,
        )

        assert result.synced is False
        mock_vs.create_task.assert_not_called()


# ---------------------------------------------------------------------------
# Tests — save_conversation: disk save failure
# ---------------------------------------------------------------------------

class TestDiskSaveFailure:
    @pytest.mark.asyncio
    async def test_save_failure_returns_saved_false(self, mock_vs, base_request):
        failing_cm = MagicMock()
        failing_cm.save = MagicMock(side_effect=OSError("Disk full"))

        result = await save_conversation(
            base_request,
            agent_type="live",
            agent_version="v1",
            conversation_manager=failing_cm,
            vikunja_service=mock_vs,
        )

        assert result.saved is False
        assert result.synced is False

    @pytest.mark.asyncio
    async def test_save_failure_after_sync_preserves_sync_error(self, mock_vs, sync_request):
        mock_vs.create_task = AsyncMock(side_effect=RuntimeError("API timeout"))

        failing_cm = MagicMock()
        failing_cm.save = MagicMock(side_effect=OSError("Disk full"))

        result = await save_conversation(
            sync_request,
            agent_type="live",
            agent_version="v1",
            conversation_manager=failing_cm,
            vikunja_service=mock_vs,
        )

        assert result.saved is False
        assert result.synced is False
        assert result.sync_error == "API timeout"
