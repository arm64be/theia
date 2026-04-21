from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator

from theia_core.detect import Edge
from theia_core.ingest import Session

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "graph.schema.json"


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
        nodes.append({
            "id": sess.id,
            "title": sess.title,
            "started_at": sess.started_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "duration_sec": sess.duration_sec,
            "tool_count": len(sess.tool_calls),
            "message_count": sess.message_count,
            "model": sess.model,
            "position": {"x": float(x), "y": float(y)},
            "features": None,
        })
    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
            for e in edges
        ],
    }


def write_graph(graph: dict[str, Any], out_path: Path) -> None:
    validator = _load_validator()
    errors = sorted(validator.iter_errors(graph), key=lambda e: e.path)
    if errors:
        messages = "\n".join(f"  - {'/'.join(map(str, e.path))}: {e.message}" for e in errors)
        raise ValueError(f"graph.json failed schema validation:\n{messages}")
    out_path.write_text(json.dumps(graph, indent=2))
