"""Theia Constellation — graph data loader.

Locates and loads the pre-built graph JSON produced by ``theia-core``.
The graph is generated offline (or via ``theia-core --watch``) and written
to ``$THEIA_HOME/theia-graph.json``.  This module simply reads that file.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger("theia-constellation")


def _theia_home() -> Path:
    """Resolve $THEIA_HOME (default: ~/.hermes/) for the running dashboard."""
    return Path(os.environ.get("THEIA_HOME", Path.home() / ".hermes"))


# ---------------------------------------------------------------------------
# Search paths for the pre-built graph file, checked in order.
#
#   1. Default theia-core output:        $THEIA_HOME/theia-graph.json
#   2. Plugin data dir (bundled fallback): <plugin>/data/graph.json
#
# The first path is the canonical location written by ``theia-core --watch``
# (or a one-shot ``theia-core`` invocation).  The second is a static fallback
# that an installer may pre-populate so the plugin renders something on a
# fresh dashboard before any sessions have been recorded.
# ---------------------------------------------------------------------------


def _search_paths() -> list[Path]:
    return [
        _theia_home() / "theia-graph.json",
        Path(__file__).parent.parent / "data" / "graph.json",
    ]


def load_graph() -> dict | None:
    """Locate and load the pre-built graph JSON file.

    Returns the parsed dict, or None if no graph file is found.
    """
    for path in _search_paths():
        if path.exists():
            log.debug("loading graph from %s", path)
            return json.loads(path.read_text(encoding="utf-8"))
    log.warning("no graph file found in any search path")
    return None
