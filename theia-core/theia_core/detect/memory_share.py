from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_memory_share(sessions: Iterable[Session]) -> list[Edge]:
    sessions = sorted(sessions, key=lambda s: s.started_at)
    # memory_id -> list of (session_id, salience) of writes, earliest first
    writes: dict[str, list[tuple[str, float]]] = defaultdict(list)
    edges_by_pair: dict[tuple[str, str, str], dict[str, Any]] = {}

    for sess in sessions:
        for event in sess.memory_events:
            if event.kind == "write":
                writes[event.memory_id].append((sess.id, event.salience))
            elif event.kind == "read":
                # Link to the most recent prior write of this memory (if any).
                prior = writes.get(event.memory_id, [])
                if not prior:
                    continue
                writer_id, salience = prior[-1]
                if writer_id == sess.id:
                    continue  # same session read its own write; not cross-session
                key = (writer_id, sess.id, event.memory_id)
                agg = edges_by_pair.setdefault(key, {"read_count": 0, "salience": salience})
                agg["read_count"] += 1

    edges: list[Edge] = []
    for (src, tgt, memory_id), agg in edges_by_pair.items():
        # weight combines salience and log-scaled read count; clamp to [0, 1]
        import math

        raw = agg["salience"] * (1 + math.log1p(agg["read_count"] - 1))
        weight = min(1.0, raw)
        edges.append(
            Edge(
                source=src,
                target=tgt,
                kind="memory-share",
                weight=weight,
                evidence={
                    "memory_id": memory_id,
                    "read_count": agg["read_count"],
                    "salience": agg["salience"],
                },
            )
        )
    return edges
