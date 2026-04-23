"""Theia Constellation — backend API routes.

Mounted at /api/plugins/theia-constellation/ by the dashboard plugin system.

Environment modes:
  - production: Builds graph dynamically from SessionDB
  - staging:    Same as production, but logs graph generation timing
  - development: Reads from static graph.json files for fast iteration;
                 returns dev_panel_url pointing at Vite dev server

Set THEIA_ENV to control the mode (default: "production").
Set THEIA_DEV_PORT to control the Vite dev server port (default: 5173).
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

THEIA_ENV = os.environ.get("THEIA_ENV", "production")
THEIA_DEV_PORT = os.environ.get("THEIA_DEV_PORT", "5173")

# ---------------------------------------------------------------------------
# Graph data sources (dev/staging fallbacks)
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


def _load_static_graph() -> dict | None:
    """Locate and load the graph JSON file (dev/staging fallback)."""
    for path in _GRAPH_SEARCH_PATHS:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def _build_live_graph() -> dict | None:
    """Build graph dynamically from Hermes SessionDB.

    Imports hermes_state at call time so the plugin doesn't crash
    if SessionDB is unavailable (e.g., in CI or standalone testing).
    """
    try:
        from hermes_state import SessionDB
    except ImportError:
        log.warning("hermes_state not available — falling back to static graph")
        return _load_static_graph()

    t0 = time.monotonic()
    db = SessionDB()
    try:
        sessions = db.list_sessions_rich(limit=9999)
    finally:
        db.close()

    if not sessions:
        return {"meta": {"generated_at": time.time()}, "nodes": [], "edges": []}

    nodes = []
    edges = []
    source_groups: dict[str, list[str]] = {}
    model_groups: dict[str, list[str]] = {}

    for s in sessions:
        sid = s["id"]
        nodes.append(
            {
                "id": sid,
                "label": s.get("title") or sid[:12],
                "x": 0,
                "y": 0,
                "group": s.get("source") or "unknown",
                "size": min(max((s.get("message_count") or 1) / 10, 0.3), 3.0),
                "meta": {
                    "model": s.get("model"),
                    "source": s.get("source"),
                    "message_count": s.get("message_count", 0),
                    "tool_call_count": s.get("tool_call_count", 0),
                    "started_at": s.get("started_at"),
                    "ended_at": s.get("ended_at"),
                },
            }
        )

        # Group by source for edge creation
        src = s.get("source") or "unknown"
        source_groups.setdefault(src, []).append(sid)

        # Group by model
        model = s.get("model") or "unknown"
        model_groups.setdefault(model, []).append(sid)

    # Create edges: temporal proximity within source groups
    for _src, sids in source_groups.items():
        # Sessions are already sorted by started_at (list_sessions_rich order)
        for i in range(len(sids) - 1):
            edges.append(
                {
                    "source": sids[i],
                    "target": sids[i + 1],
                    "kind": "temporal",
                    "weight": 0.3,
                }
            )

    # Create edges: shared model (connect first 50 pairs to avoid O(n^2))
    for _model, sids in model_groups.items():
        if len(sids) < 2:
            continue
        pairs = 0
        for i in range(len(sids)):
            for j in range(i + 1, len(sids)):
                if pairs >= 50:
                    break
                edges.append(
                    {
                        "source": sids[i],
                        "target": sids[j],
                        "kind": "model-share",
                        "weight": 0.1,
                    }
                )
                pairs += 1
            if pairs >= 50:
                break

    elapsed = time.monotonic() - t0
    if THEIA_ENV == "staging":
        log.info(
            "Graph built in %.2fs: %d nodes, %d edges", elapsed, len(nodes), len(edges)
        )

    return {
        "meta": {
            "generated_at": time.time(),
            "node_count": len(nodes),
            "edge_count": len(edges),
            "env": THEIA_ENV,
            "build_time_ms": round(elapsed * 1000, 1),
        },
        "nodes": nodes,
        "edges": edges,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_config():
    """Return plugin configuration including environment info.

    In development mode, returns dev_panel_url so the frontend JS
    can proxy the iframe to the Vite dev server for hot-reload.
    """
    config: dict = {"env": THEIA_ENV, "version": "0.1.0"}

    if THEIA_ENV == "development":
        config["dev_panel_url"] = f"http://localhost:{THEIA_DEV_PORT}"

    return config


@router.get("/graph")
async def get_graph():
    """Return the constellation graph data.

    - development: reads static graph.json for speed
    - staging/production: builds from SessionDB
    """
    if THEIA_ENV == "development":
        graph = _load_static_graph()
        if graph is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error": "No graph data found. Run: python -m theia_core examples/sessions -o examples/graph.json"
                },
            )
        return graph

    # staging / production: build from live data
    graph = _build_live_graph()
    if graph is None:
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to build graph from session data"},
        )
    return graph


@router.get("/health")
async def health():
    """Health check for CI/monitoring."""
    return {"status": "ok", "env": THEIA_ENV}
