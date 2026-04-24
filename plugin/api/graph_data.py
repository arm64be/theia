"""Theia Constellation — graph data loader.

Locates and loads the pre-built graph JSON produced by ``theia-core``.
The graph is generated offline (or via ``theia-core --watch``) and written
to ``$THEIA_HOME/theia-graph.json``.  This module simply reads that file.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Search paths for the pre-built graph file, checked in order.
#
#   1. Default theia-core output:  ~/.hermes/theia-graph.json
#   2. Plugin data dir (deployed):  <plugin>/data/graph.json
#   3. Dev workspace fallback:      <repo>/theia/examples/graph.json
# ---------------------------------------------------------------------------

_GRAPH_SEARCH_PATHS = [
    Path.home() / ".hermes" / "theia-graph.json",
    Path.home() / ".hermes" / "plugins" / "theia-constellation" / "data" / "graph.json",
    Path(__file__).parent.parent / "data" / "graph.json",
    Path.home()
    / "projects"
    / "hermes-hackathon-seshviz"
    / "theia"
    / "examples"
    / "graph.json",
]


def load_graph() -> dict | None:
    """Locate and load the pre-built graph JSON file.

    Returns the parsed dict, or None if no graph file is found.
    """
    for path in _GRAPH_SEARCH_PATHS:
        if path.exists():
            log.debug("loading graph from %s", path)
            return json.loads(path.read_text(encoding="utf-8"))
    log.warning("no graph file found in any search path")
    return None
