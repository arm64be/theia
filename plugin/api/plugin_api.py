"""Theia Constellation — backend API routes.

Mounted at /api/plugins/theia-constellation/ by the dashboard plugin system.

The graph is pre-built by ``theia-core`` (run with ``--watch`` for live
regeneration) and written to ``$THEIA_HOME/theia-graph.json``.  This API
simply reads and serves that file.

Environment modes:
  - production / staging: Serves the pre-built graph JSON
  - development: Returns dev_panel_url pointing at Vite dev server

Set THEIA_ENV to control the mode (default: "production").
Set THEIA_DEV_HOST to override the Vite dev server host (default: derived
  from incoming request headers).
Set THEIA_DEV_PORT to control the Vite dev server port (default: 5173).
Port validation rejects ports < 1024 and well-known Hermes ports (e.g. 9119).
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .graph_data import load_graph

router = APIRouter()
log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

THEIA_ENV = os.environ.get("THEIA_ENV", "production")
THEIA_DEV_HOST = os.environ.get("THEIA_DEV_HOST", "")
THEIA_DEV_PORT = os.environ.get("THEIA_DEV_PORT", "5173")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BLOCKED_PORTS: set[int] = {9119}


def _validate_port(port: str | int) -> int:
    """Validate and return the port number.

    Raises ``ValueError`` if the port is out of range or blocked.
    """
    try:
        p = int(port)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid port: {port!r}")

    if p < 1024:
        raise ValueError(f"Port {p} is reserved (must be >= 1024)")
    if p in _BLOCKED_PORTS:
        raise ValueError(f"Port {p} is blocked (well-known Hermes port)")

    return p


def _resolve_dev_url(host: str) -> str:
    """Build dev panel URL from configuration or request host."""
    port = _validate_port(THEIA_DEV_PORT)
    resolved_host = THEIA_DEV_HOST or host
    return f"http://{resolved_host}:{port}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_config(request: Request):
    """Return plugin configuration including environment info.

    In development mode, returns dev_panel_url so the frontend JS
    can proxy the iframe to the Vite dev server for hot-reload.
    The host is derived from the incoming request headers
    (``x-forwarded-host`` or ``host``), overridable via ``THEIA_DEV_HOST``.
    """
    config: dict = {"env": THEIA_ENV, "version": "0.1.0"}

    if THEIA_ENV == "development":
        forwarded = request.headers.get("x-forwarded-host", "")
        raw_host = request.headers.get("host", "localhost")
        host = (forwarded or raw_host).split(":")[0]

        try:
            config["dev_panel_url"] = _resolve_dev_url(host)
        except ValueError as e:
            log.warning("Invalid dev port configuration: %s", e)
            config["dev_panel_url"] = None
            config["dev_panel_error"] = str(e)

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
