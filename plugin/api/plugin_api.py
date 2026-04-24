"""Theia Constellation — backend API routes.

Mounted at /api/plugins/theia-constellation/ by the dashboard plugin system.

The graph is pre-built by ``theia-core`` (run with ``--watch`` for live
regeneration) and written to ``$THEIA_HOME/theia-graph.json``.  This API
simply reads and serves that file.

Environment modes:
  - production / staging: Serves the pre-built graph JSON
  - development: Returns dev_panel_url pointing at Vite dev server

Set THEIA_ENV to control the mode (default: "production").
Set THEIA_DEV_PORT to control the Vite dev server port (default: 5173).
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .graph_data import load_graph

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
    """Serve the pre-built constellation graph data.

    Reads the graph JSON produced by ``theia-core``.  Returns 404 if no
    graph file has been generated yet (run ``theia-core --watch`` or
    ``make build-graph`` to generate one).
    """
    graph = load_graph()
    if graph is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": (
                    "No graph data found. "
                    "Run: theia-core --watch  (or: make build-graph)"
                )
            },
        )
    return graph


@router.get("/health")
async def health():
    """Health check for CI/monitoring."""
    return {"status": "ok", "env": THEIA_ENV}
