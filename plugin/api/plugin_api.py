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

import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .graph_builder import build_live_graph
from .graph_data import load_static_graph
from .graph_utils import iso_now

router = APIRouter()
log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

THEIA_ENV = os.environ.get("THEIA_ENV", "production")
THEIA_DEV_PORT = os.environ.get("THEIA_DEV_PORT", "5173")

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
        graph = load_static_graph()
        if graph is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error": "No graph data found. Run: python -m theia_core examples/sessions -o examples/graph.json"
                },
            )
        return graph

    # staging / production: build from live data
    graph = build_live_graph(env=THEIA_ENV)
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
