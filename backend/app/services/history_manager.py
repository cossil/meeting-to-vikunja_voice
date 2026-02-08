import os
import re
import json
import logging
from pathlib import Path
from datetime import datetime

from app.models.schemas import AnalysisResponse

logger = logging.getLogger(__name__)


class HistoryManager:
    """Persists batch analysis results to disk as JSON files."""

    HISTORY_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "history"

    def save(self, result: AnalysisResponse, model_used: str = "gemini-3-flash-preview") -> Path:
        """
        Persist an AnalysisResponse to disk.
        Returns the Path of the saved file.
        Raises on failure (caller is responsible for catching).
        """
        os.makedirs(self.HISTORY_DIR, exist_ok=True)

        record = self._build_record(result, model_used)
        filename = self._generate_filename(result)
        target_path = self.HISTORY_DIR / filename

        # Handle unlikely collision
        if target_path.exists():
            stem = target_path.stem
            for i in range(1, 100):
                candidate = self.HISTORY_DIR / f"{stem}_{i}.json"
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

        logger.info("History saved: %s", target_path.name)
        return target_path

    def _generate_filename(self, result: AnalysisResponse) -> str:
        """Build YYYYMMDD-HHMMSS_{name}.json filename."""
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")

        if result.file_count > 1:
            name_part = f"multi_{result.file_count}_files"
        elif result.file_names:
            raw = os.path.splitext(result.file_names[0])[0]
            name_part = self._sanitize(raw)
        else:
            name_part = "unknown"

        return f"{ts}_{name_part}.json"

    @staticmethod
    def _sanitize(name: str) -> str:
        """Replace non-alphanumeric chars (except - and _) with _, truncate to 50."""
        cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", name)
        cleaned = re.sub(r"_+", "_", cleaned).strip("_")
        return cleaned[:50] if cleaned else "unnamed"

    def list_all(self) -> list[dict]:
        """Return lightweight summaries of all saved analyses, newest first."""
        if not self.HISTORY_DIR.exists():
            return []

        items = []
        for path in self.HISTORY_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                items.append({
                    "id": data.get("id", path.stem),
                    "timestamp": data.get("timestamp", ""),
                    "source_files": data.get("source_files", []),
                    "file_count": data.get("file_count", 0),
                    "task_count": len(data.get("analysis", {}).get("tasks", [])),
                    "model_used": data.get("model_used", ""),
                })
            except Exception:
                logger.warning("Skipping corrupt history file: %s", path.name)
        
        items.sort(key=lambda x: x["timestamp"], reverse=True)
        return items

    def get_by_id(self, history_id: str) -> dict | None:
        """Return full JSON content for a specific analysis, or None if not found."""
        if not self.HISTORY_DIR.exists():
            return None

        for path in self.HISTORY_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if data.get("id") == history_id or path.stem == history_id:
                    return data
            except Exception:
                logger.warning("Skipping corrupt history file: %s", path.name)
        return None

    @staticmethod
    def _build_record(result: AnalysisResponse, model_used: str) -> dict:
        """Assemble the full JSON record with metadata envelope."""
        now = datetime.now()
        ts_prefix = now.strftime("%Y%m%d-%H%M%S")

        if result.file_count > 1:
            id_suffix = f"multi_{result.file_count}_files"
        elif result.file_names:
            id_suffix = HistoryManager._sanitize(
                os.path.splitext(result.file_names[0])[0]
            )
        else:
            id_suffix = "unknown"

        return {
            "id": f"{ts_prefix}-{id_suffix}",
            "timestamp": now.isoformat(),
            "source_files": result.file_names,
            "file_count": result.file_count,
            "model_used": model_used,
            "token_count": result.token_count,
            "processing_time": result.processing_time,
            "analysis": {
                "tasks": [t.model_dump() for t in result.tasks],
            },
        }
