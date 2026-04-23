from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator

from theia_core.detect import Edge
from theia_core.ingest import Session

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "graph.schema.json"


def _extract_summary(sess: Session) -> str | None:
    raw = sess.raw
    if not raw:
        return None
    if "summary" in raw and isinstance(raw["summary"], str):
        return raw["summary"]
    return None


def _extract_initial_prompt(sess: Session) -> str | None:
    raw = sess.raw
    if not raw:
        return None
    # Check explicit field first
    if "initial_prompt" in raw and isinstance(raw["initial_prompt"], str):
        return raw["initial_prompt"]
    # Fallback: first user message content in messages array
    messages = raw.get("messages", [])
    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return None


def _load_validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text())
    return Draft202012Validator(schema)


def build_graph(
    sessions: list[Session],
    edges: list[Edge],
    positions: np.ndarray,
    projection: str,
    feature_dim: int,
) -> dict[str, Any]:
    assert positions.shape == (len(sessions), 2)
    nodes = []
    for sess, (x, y) in zip(sessions, positions, strict=True):
        nodes.append(
            {
                "id": sess.id,
                "title": sess.title,
                "started_at": sess.started_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "duration_sec": sess.duration_sec,
                "tool_count": len(sess.tool_calls),
                "message_count": sess.message_count,
                "model": sess.model,
                "summary": _extract_summary(sess),
                "initial_prompt": _extract_initial_prompt(sess),
                "position": {"x": float(x), "y": float(y)},
                "features": None,
            }
        )
    session_ids = {sess.id for sess in sessions}
    valid_edges = [e for e in edges if e.source in session_ids and e.target in session_ids]
    return {
        "meta": {
            "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "source_count": len(sessions),
            "projection": projection,
            "feature_dim": feature_dim,
        },
        "nodes": nodes,
        "edges": [
            {
                "source": e.source,
                "target": e.target,
                "kind": e.kind,
                "weight": e.weight,
                "evidence": e.evidence,
            }
            for e in valid_edges
        ],
    }


def write_graph(graph: dict[str, Any], out_path: Path) -> None:
    validator = _load_validator()
    errors = sorted(validator.iter_errors(graph), key=lambda e: e.path)
    if errors:
        messages = "\n".join(f"  - {'/'.join(map(str, e.path))}: {e.message}" for e in errors)
        raise ValueError(f"graph.json failed schema validation:\n{messages}")
    out_path.write_text(json.dumps(graph, indent=2))
