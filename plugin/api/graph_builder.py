"""Theia Constellation — top-level graph builder (orchestrator).

Fetches sessions from SessionDB, transforms them into nodes,
computes positions, builds edges, and returns the final graph dict
conforming to schemas/graph.schema.json.
"""

from __future__ import annotations

import logging
import time

from .graph_data import fetch_sessions, load_static_graph
from .graph_edges import build_edges
from .graph_projection import compute_positions
from .graph_utils import compute_duration, iso_now, timestamp_to_iso

log = logging.getLogger("theia-constellation")


def _empty_graph() -> dict:
    """Return a valid graph dict with zero nodes/edges."""
    return {
        "meta": {
            "generated_at": iso_now(),
            "source_count": 0,
            "projection": "pca",
        },
        "nodes": [],
        "edges": [],
    }


def _sessions_to_nodes(
    sessions: list[dict],
) -> tuple[list[dict], dict[str, list[int]], dict[str, list[int]]]:
    """Convert raw session dicts to graph nodes and grouping indices.

    Returns (nodes, source_groups, model_groups).
    """
    nodes: list[dict] = []
    source_groups: dict[str, list[int]] = {}
    model_groups: dict[str, list[int]] = {}

    for idx, s in enumerate(sessions):
        sid = s["id"]
        started = s.get("started_at")
        ended = s.get("ended_at")
        model = s.get("model") or "unknown"
        source = s.get("source") or "unknown"

        nodes.append(
            {
                "id": sid,
                "title": s.get("title") or sid[:20],
                "started_at": timestamp_to_iso(started),
                "duration_sec": round(compute_duration(started, ended), 1),
                "tool_count": s.get("tool_call_count", 0) or 0,
                "message_count": s.get("message_count", 0) or 0,
                "model": model,
                "position": {"x": 0.0, "y": 0.0},
                "features": None,
            }
        )

        source_groups.setdefault(source, []).append(idx)
        model_groups.setdefault(model, []).append(idx)

    return nodes, source_groups, model_groups


def build_live_graph(env: str = "production") -> dict | None:
    """Build graph dynamically from Hermes SessionDB.

    Output conforms to schemas/graph.schema.json — the same format
    that theia-core produces and theia-panel consumes.
    """
    sessions = fetch_sessions()
    if sessions is None:
        # SessionDB unavailable — try static fallback
        return load_static_graph()

    if not sessions:
        return _empty_graph()

    t0 = time.monotonic()

    # 1. Transform sessions -> nodes + grouping dicts
    nodes, source_groups, model_groups = _sessions_to_nodes(sessions)

    # 2. Compute 2D positions via PCA-like projection
    compute_positions(nodes)

    # 3. Build and deduplicate edges
    edges = build_edges(nodes, source_groups, model_groups)

    elapsed = time.monotonic() - t0
    if env == "staging":
        log.info(
            "Graph built in %.2fs: %d nodes, %d edges",
            elapsed,
            len(nodes),
            len(edges),
        )

    return {
        "meta": {
            "generated_at": iso_now(),
            "source_count": len(source_groups),
            "projection": "pca",
        },
        "nodes": nodes,
        "edges": edges,
    }
