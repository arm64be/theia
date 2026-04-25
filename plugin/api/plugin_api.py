"""Theia Constellation — backend API routes.

Mounted at /api/plugins/theia-constellation/ by the dashboard plugin system.

The graph is pre-built by ``theia-core`` (run with ``--watch`` for live
regeneration) and written to ``$THEIA_HOME/theia-graph.json``.  This API
simply reads and serves that file.

Environment modes:
  - production / staging: Serves the pre-built graph JSON
  - development: Returns dev_panel_url pointing at Vite dev server

Set THEIA_ENV to control the mode (default: "production").
Set THEIA_DEV_HOST to override the Vite dev server host (default: localhost).
Set THEIA_DEV_PORT to control the Vite dev server port (default: 5173).
Port validation rejects privileged ports (< 1024), ports > 65535, and
well-known Hermes ports (e.g. 9119).
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# Resolve ``load_graph`` in a way that works regardless of how this module
# is imported by the host dashboard.
#
# The Hermes plugin loader has historically used
# ``importlib.util.spec_from_file_location`` with a flat module name and no
# parent package, which makes the relative form ``from .graph_data import ...``
# raise ``ImportError: attempted relative import with no known parent package``.
# When that import fails the FastAPI router never registers, the ``/graph``
# route falls through to the SPA catch-all, and the frontend tries to
# ``JSON.parse`` an HTML page (issue #66).
#
# The proper fix is to upstream the package-aware loader patch
# (``submodule_search_locations`` + synthetic parent package), but until that
# reaches every Hermes install we keep this module portable: prefer the
# relative import when we *are* loaded as part of a package, and fall back
# to a direct file load otherwise.
try:
    from .graph_data import load_graph  # noqa: F401  (preferred path)
except ImportError:  # pragma: no cover - exercised on un-patched Hermes loaders
    import importlib.util
    from pathlib import Path

    _graph_data_path = Path(__file__).with_name("graph_data.py")
    _spec = importlib.util.spec_from_file_location(
        "_theia_constellation_graph_data", _graph_data_path
    )
    if _spec is None or _spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(
            f"Cannot load graph_data module from {_graph_data_path}"
        ) from None
    _graph_data = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_graph_data)
    load_graph = _graph_data.load_graph

router = APIRouter()
log = logging.getLogger("theia-constellation")

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

THEIA_ENV = os.environ.get("THEIA_ENV", "production")
_THEIA_DEV_HOST_RAW = os.environ.get("THEIA_DEV_HOST", "")
_THEIA_DEV_PORT_RAW = os.environ.get("THEIA_DEV_PORT", "5173")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BLOCKED_PORTS: frozenset[int] = frozenset({9119})

_DEV_PORT: int | None = None
_DEV_PORT_ERROR: str | None = None


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
    if p > 65535:
        raise ValueError(f"Port {p} is out of range (must be <= 65535)")
    if p in _BLOCKED_PORTS:
        raise ValueError(f"Port {p} is blocked (well-known Hermes port)")

    return p


try:
    _DEV_PORT = _validate_port(_THEIA_DEV_PORT_RAW)
except ValueError as e:
    _DEV_PORT_ERROR = str(e)
    log.warning("Invalid THEIA_DEV_PORT configuration: %s", _DEV_PORT_ERROR)


def _extract_host(host: str) -> str:
    """Extract hostname from a ``host[:port]`` string, handling IPv6."""
    host = host.strip()
    if not host:
        return "localhost"
    if host.startswith("["):
        host = host.split("]")[0][1:]
        return host or "localhost"
    if host.count(":") > 1:
        return host
    return host.split(":")[0]


def _format_host_for_url(host: str) -> str:
    """Wrap IPv6 addresses in brackets for URL use."""
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def _resolve_dev_url(host: str) -> str:
    """Build dev panel URL from configuration or request host."""
    if _DEV_PORT_ERROR:
        raise ValueError(_DEV_PORT_ERROR)
    clean_host = _extract_host(host)
    formatted_host = _format_host_for_url(clean_host)
    return f"http://{formatted_host}:{_DEV_PORT}"


# Validate THEIA_DEV_HOST at import time and cache result, mirroring port
# validation.  This rejects empty hostnames (e.g. bare ":port" values) and
# values that resolve to nothing after extraction.
_THEIA_DEV_HOST: str | None = None
_THEIA_DEV_HOST_ERROR: str | None = None

_host_stripped = _THEIA_DEV_HOST_RAW.strip()
if _host_stripped:
    candidate = _extract_host(_host_stripped)
    if not candidate:
        _THEIA_DEV_HOST_ERROR = (
            f"THEIA_DEV_HOST={_THEIA_DEV_HOST_RAW!r} resolved to empty hostname"
        )
    else:
        _THEIA_DEV_HOST = _host_stripped

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_config(request: Request):
    """Return plugin configuration including environment info.

    In development mode, returns dev_panel_url so the frontend JS
    can proxy the iframe to the Vite dev server for hot-reload.
    The host defaults to ``localhost`` and can be overridden via
    ``THEIA_DEV_HOST``.  Request headers are never trusted for
    host resolution.
    """
    config: dict = {"env": THEIA_ENV, "version": "0.1.0"}

    if THEIA_ENV == "development":
        host = _THEIA_DEV_HOST or "localhost"

        try:
            config["dev_panel_url"] = _resolve_dev_url(host)
        except ValueError as e:
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
