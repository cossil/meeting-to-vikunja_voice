import os
import re
import json
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


class ConversationManager:
    """Persists Live Agent conversation logs to disk as JSON files."""

    CONVERSATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "conversations"

    def save(self, record: dict) -> Path:
        """
        Persist a conversation record to disk.
        Returns the Path of the saved file.
        Raises on failure (caller is responsible for catching).
        """
        os.makedirs(self.CONVERSATIONS_DIR, exist_ok=True)

        filename = self._generate_filename(record)
        target_path = self.CONVERSATIONS_DIR / filename

        # Handle unlikely collision
        if target_path.exists():
            stem = target_path.stem
            for i in range(1, 100):
                candidate = self.CONVERSATIONS_DIR / f"{stem}_{i}.json"
                if not candidate.exists():
                    target_path = candidate
                    break

        # Atomic write: write to .tmp then rename
        tmp_path = target_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.rename(target_path)

        logger.info("Conversation saved: %s", target_path.name)
        return target_path

    def _generate_filename(self, record: dict) -> str:
        """Build YYYYMMDD-HHMMSS_{session_short}.json filename."""
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        session_id = record.get("session_id", "unknown")
        # Use first 8 chars of session_id for brevity
        short = self._sanitize(session_id[:8]) if session_id else "unknown"
        return f"{ts}_{short}.json"

    @staticmethod
    def _sanitize(name: str) -> str:
        """Replace non-alphanumeric chars (except - and _) with _, truncate to 50."""
        cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", name)
        cleaned = re.sub(r"_+", "_", cleaned).strip("_")
        return cleaned[:50] if cleaned else "unnamed"

    def list_all(self) -> list[dict]:
        """Return lightweight summaries of all saved conversations, newest first."""
        if not self.CONVERSATIONS_DIR.exists():
            return []

        items = []
        for path in self.CONVERSATIONS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                task_draft = data.get("task_draft", {})
                items.append({
                    "id": data.get("id", path.stem),
                    "timestamp": data.get("timestamp", ""),
                    "agent_type": data.get("agent_type", "live"),
                    "synced_to_vikunja": data.get("synced_to_vikunja", False),
                    "task_title": task_draft.get("title", ""),
                    "turn_count": len(data.get("transcript", [])),
                })
            except Exception:
                logger.warning("Skipping corrupt conversation file: %s", path.name)

        items.sort(key=lambda x: x["timestamp"], reverse=True)
        return items

    def get_by_id(self, conversation_id: str) -> dict | None:
        """Return full conversation JSON, or None if not found."""
        if not self.CONVERSATIONS_DIR.exists():
            return None

        for path in self.CONVERSATIONS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if data.get("id") == conversation_id or path.stem == conversation_id:
                    return data
            except Exception:
                logger.warning("Skipping corrupt conversation file: %s", path.name)
        return None
