"""Theia Constellation — data loading and static graph fallback."""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Static graph search paths (dev/staging fallbacks)
# ---------------------------------------------------------------------------

_GRAPH_SEARCH_PATHS = [
    Path.home() / ".hermes" / "plugins" / "theia-constellation" / "data" / "graph.json",
    Path(__file__).parent.parent / "data" / "graph.json",
    Path.home()
    / "projects"
    / "hermes-hackathon-seshviz"
    / "theia"
    / "examples"
    / "graph.json",
]


def load_static_graph() -> dict | None:
    """Locate and load the graph JSON file (dev/staging fallback)."""
    for path in _GRAPH_SEARCH_PATHS:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def fetch_sessions(limit: int = 9999) -> list[dict] | None:
    """Fetch session data from SessionDB.

    Returns None if hermes_state is not available (CI / standalone).
    Uses a context-manager pattern to ensure the DB is always closed.
    """
    try:
        from hermes_state import SessionDB
    except ImportError:
        log.warning("hermes_state not available — cannot fetch sessions")
        return None

    db = SessionDB()
    try:
        return db.list_sessions_rich(limit=limit)
    finally:
        db.close()
