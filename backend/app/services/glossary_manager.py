import json
import os
import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Default path: <project_root>/glossary.json (two levels up from this file)
_DEFAULT_PATH = str(Path(__file__).resolve().parents[3] / "glossary.json")

SEED_DATA: Dict[str, List[str]] = {
    "Hankell": ["Rankel", "Ranquel", "Hanke", "Rank", "Hankel", "Hanquel"],
    "Cenize": ["Senize", "Semize", "Zenize"],
    "Roquelina": ["Rock", "Roque", "Roc", "Hock"],
    "APN": ["PN", "A pena", "Apn", "A.P.N."],
    "Intelbras": ["Inteoubras", "Intel", "Inteobras"],
    "Datatem": ["Data tem", "Dataten", "Data ten"],
    "Odoo": ["Odo", "Hoodoo", "Odum"],
}


class GlossaryManager:
    """Single source of truth for the phonetic glossary used by all agents."""

    def __init__(self, file_path: Optional[str] = None):
        self.file_path = file_path or _DEFAULT_PATH
        self._cache: Optional[Dict[str, List[str]]] = None
        self._mtime: float = 0.0

        if not os.path.exists(self.file_path):
            os.makedirs(os.path.dirname(os.path.abspath(self.file_path)), exist_ok=True)
            self._write(SEED_DATA)

    # --- Public API -----------------------------------------------------------

    def load(self) -> Dict[str, List[str]]:
        """Return glossary dict, reloading from disk only when the file has changed."""
        try:
            current_mtime = os.path.getmtime(self.file_path)
            if self._cache is None or current_mtime != self._mtime:
                with open(self.file_path, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
                self._mtime = current_mtime
            return self._cache  # type: ignore[return-value]
        except Exception as e:
            logger.warning("Failed to load glossary, using seed data: %s", e)
            return dict(SEED_DATA)

    def save(self, data: Dict[str, List[str]]) -> None:
        """Overwrite the entire glossary with *data* and refresh cache."""
        self._write(data)

    def add_term(self, term: str, variations: List[str]) -> Dict[str, List[str]]:
        """Add or update a single term. Returns the full updated glossary."""
        assert term and isinstance(variations, list), "term must be non-empty, variations must be a list"
        data = self.load()
        data[term] = variations
        self._write(data)
        return data

    def remove_term(self, term: str) -> Dict[str, List[str]]:
        """Remove a term by key. Returns the full updated glossary."""
        data = self.load()
        data.pop(term, None)
        self._write(data)
        return data

    def get_prompt_rules(self) -> str:
        """Format glossary as prompt injection rules for Gemini."""
        data = self.load()
        rules = []
        for correct, variations in data.items():
            vars_str = ", ".join(variations)
            rules.append(f"- Se ouvir: {vars_str} -> Escreva: {correct}")
        return "\n".join(rules)

    # --- Internal helpers -----------------------------------------------------

    def _write(self, data: Dict[str, List[str]]) -> None:
        try:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            self._cache = data
            self._mtime = os.path.getmtime(self.file_path)
        except Exception as e:
            logger.error("Failed to save glossary: %s", e)
