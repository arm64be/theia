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

    for sess in sessions:
        for event in sess.memory_events:
            if event.kind == "write":
                writes[event.memory_id].append((sess.id, event.salience))

    edges: list[Edge] = []
    for memory_id, writers in writes.items():
        if len(writers) < 2:
            continue
        for i in range(len(writers)):
            for j in range(i + 1, len(writers)):
                a_id, a_sal = writers[i]
                b_id, b_sal = writers[j]
                edges.append(
                    Edge(
                        source=a_id,
                        target=b_id,
                        kind="memory-share",
                        weight=min(1.0, max(a_sal, b_sal)),
                        evidence={
                            "memory_id": memory_id,
                            "writers": sorted({a_id, b_id}),
                        },
                    )
                )
    return edges
