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

    Output conforms to schemas/graph.schema.json — the same format
    that theia-core produces and theia-panel consumes.

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
        return {
            "meta": {
                "generated_at": _iso_now(),
                "source_count": 0,
                "projection": "pca",
            },
            "nodes": [],
            "edges": [],
        }

    # ------------------------------------------------------------------
    # Build nodes (schema: id, title, started_at, duration_sec,
    #              tool_count, message_count, model, position, features)
    # ------------------------------------------------------------------
    nodes = []
    source_groups: dict[str, list[int]] = {}  # source -> list of node indices
    model_groups: dict[str, list[int]] = {}

    for idx, s in enumerate(sessions):
        sid = s["id"]
        started = s.get("started_at")
        ended = s.get("ended_at")

        # Compute duration
        if started and ended:
            duration = max(0.0, float(ended) - float(started))
        else:
            duration = 0.0

        # Format started_at as ISO 8601
        if started:
            from datetime import datetime, timezone

            started_iso = datetime.fromtimestamp(
                float(started), tz=timezone.utc
            ).isoformat()
        else:
            started_iso = "1970-01-01T00:00:00+00:00"

        nodes.append(
            {
                "id": sid,
                "title": s.get("title") or sid[:20],
                "started_at": started_iso,
                "duration_sec": round(duration, 1),
                "tool_count": s.get("tool_call_count", 0) or 0,
                "message_count": s.get("message_count", 0) or 0,
                "model": s.get("model") or "unknown",
                "position": {"x": 0.0, "y": 0.0},  # filled by projection below
                "features": None,
            }
        )

        # Group by source for edge creation
        src = s.get("source") or "unknown"
        source_groups.setdefault(src, []).append(idx)

        # Group by model
        model = s.get("model") or "unknown"
        model_groups.setdefault(model, []).append(idx)

    # ------------------------------------------------------------------
    # Compute 2D positions via simple PCA-like projection
    # Features: [message_count_norm, tool_count_norm, duration_norm,
    #            source_hash, model_hash]
    # ------------------------------------------------------------------
    import hashlib
    import math

    n = len(nodes)

    def _hash_to_float(s: str) -> float:
        h = int(hashlib.md5(s.encode()).hexdigest()[:8], 16)
        return (h % 10000) / 10000.0

    # Build feature matrix
    max_msgs = max((nd["message_count"] for nd in nodes), default=1) or 1
    max_tools = max((nd["tool_count"] for nd in nodes), default=1) or 1
    max_dur = max((nd["duration_sec"] for nd in nodes), default=1) or 1

    features = []
    for nd in nodes:
        features.append(
            [
                nd["message_count"] / max_msgs,
                nd["tool_count"] / max_tools,
                nd["duration_sec"] / max_dur,
                _hash_to_float(nd["model"]),
                _hash_to_float(nd["started_at"][:10]),  # date hash
            ]
        )

    # Center the features
    dim = len(features[0])
    means = [sum(f[d] for f in features) / n for d in range(dim)]
    centered = [[f[d] - means[d] for d in range(dim)] for f in features]

    # Simple PCA: compute covariance, find top-2 eigenvectors via power iteration
    # For speed with large n, use a simpler approach: project onto variance axes
    variances = [sum(c[d] ** 2 for c in centered) / n for d in range(dim)]
    sorted_dims = sorted(range(dim), key=lambda d: -variances[d])
    d1, d2 = sorted_dims[0], sorted_dims[1]

    # Project onto top-2 variance dimensions and normalize to [-1, 1]
    xs = [c[d1] for c in centered]
    ys = [c[d2] for c in centered]

    # Add jitter based on index to prevent overlap for identical sessions
    for i in range(n):
        jitter_x = math.sin(i * 2.399) * 0.05  # golden angle
        jitter_y = math.cos(i * 2.399) * 0.05
        xs[i] += jitter_x
        ys[i] += jitter_y

    max_x = max(abs(v) for v in xs) or 1.0
    max_y = max(abs(v) for v in ys) or 1.0

    for i in range(n):
        nodes[i]["position"]["x"] = round(xs[i] / max_x, 6)
        nodes[i]["position"]["y"] = round(ys[i] / max_y, 6)

    # ------------------------------------------------------------------
    # Build edges (schema kinds: memory-share, cross-search, tool-overlap)
    # ------------------------------------------------------------------
    edges = []

    # Temporal proximity within source → map to "cross-search" (sessions in
    # the same source likely search/reference each other)
    for _src, idxs in source_groups.items():
        for i in range(len(idxs) - 1):
            edges.append(
                {
                    "source": nodes[idxs[i]]["id"],
                    "target": nodes[idxs[i + 1]]["id"],
                    "kind": "cross-search",
                    "weight": 0.4,
                }
            )

    # Shared model → map to "tool-overlap" (sessions sharing the same
    # model/tooling infrastructure). Connect sequential pairs only
    # to keep edge count manageable.
    for _model, idxs in model_groups.items():
        if len(idxs) < 2:
            continue
        # Connect a sliding window of 3 to form local clusters
        for i in range(len(idxs) - 1):
            edges.append(
                {
                    "source": nodes[idxs[i]]["id"],
                    "target": nodes[idxs[i + 1]]["id"],
                    "kind": "tool-overlap",
                    "weight": 0.15,
                }
            )
            # Skip connections for every other pair to reduce density
            if i + 2 < len(idxs) and i % 3 == 0:
                edges.append(
                    {
                        "source": nodes[idxs[i]]["id"],
                        "target": nodes[idxs[i + 2]]["id"],
                        "kind": "tool-overlap",
                        "weight": 0.08,
                    }
                )

    # Deduplicate edges (same source-target pair, keep highest weight)
    seen_edges: dict[tuple[str, str], dict] = {}
    for e in edges:
        key = (e["source"], e["target"])
        rev = (e["target"], e["source"])
        if key in seen_edges:
            if e["weight"] > seen_edges[key]["weight"]:
                seen_edges[key] = e
        elif rev in seen_edges:
            if e["weight"] > seen_edges[rev]["weight"]:
                seen_edges[rev] = e
        else:
            seen_edges[key] = e
    edges = list(seen_edges.values())

    elapsed = time.monotonic() - t0
    if THEIA_ENV == "staging":
        log.info(
            "Graph built in %.2fs: %d nodes, %d edges",
            elapsed,
            len(nodes),
            len(edges),
        )

    return {
        "meta": {
            "generated_at": _iso_now(),
            "source_count": len(source_groups),
            "projection": "pca",
        },
        "nodes": nodes,
        "edges": edges,
    }


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).isoformat()


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
