from __future__ import annotations

import functools
import json
import sys
from collections import Counter
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
    """Return the full first user message content, or None."""
    raw = sess.raw
    if not raw:
        return None
    if "initial_prompt" in raw and isinstance(raw["initial_prompt"], str):
        return raw["initial_prompt"]
    messages = raw.get("messages", [])
    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return None


@functools.lru_cache(maxsize=1)
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
    if positions.shape != (len(sessions), 2):
        raise ValueError(
            f"position shape {positions.shape} does not match session count {len(sessions)}"
        )
    nodes = []
    for sess, (x, y) in zip(sessions, positions, strict=True):
        nodes.append(
            {
                "id": sess.id,
                "title": sess.title,
                "preview": sess.preview,
                "started_at": sess.started_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "duration_sec": sess.duration_sec,
                "tool_count": len(sess.tool_calls),
                "message_count": sess.message_count,
                "model": sess.model,
                "summary": _extract_summary(sess),
                "initial_prompt": _extract_initial_prompt(sess),
                "position": {"x": float(x), "y": float(y)},
                "features": None,
                "parent_id": sess.parent_id,
            }
        )
    session_ids = {sess.id for sess in sessions}
    valid_edges: list[Edge] = []
    dropped: list[tuple[Edge, list[str]]] = []
    for e in edges:
        missing = [
            label
            for label, sid in (("source", e.source), ("target", e.target))
            if sid not in session_ids
        ]
        if missing:
            dropped.append((e, missing))
        else:
            valid_edges.append(e)

    if dropped:
        by_kind: Counter[str] = Counter(e.kind for e, _ in dropped)
        summary = ", ".join(f"{kind}={count}" for kind, count in sorted(by_kind.items()))
        print(
            f"warning: dropped {len(dropped)} edge(s) with unknown endpoints ({summary})",
            file=sys.stderr,
        )
        # Surface up to 5 examples so users can spot which sessions are missing.
        for e, missing in dropped[:5]:
            missing_ids = ", ".join(
                f"{label}={getattr(e, label)}" for label in missing
            )
            print(
                f"         [{e.kind}] {e.source} -> {e.target}  missing: {missing_ids}",
                file=sys.stderr,
            )
        if len(dropped) > 5:
            print(f"         ...and {len(dropped) - 5} more", file=sys.stderr)

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
