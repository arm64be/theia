from __future__ import annotations

from collections.abc import Iterable

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_memory_share(sessions: Iterable[Session]) -> list[Edge]:
    sessions = sorted(sessions, key=lambda s: s.started_at)
    # memory_id -> last session_id that wrote it
    last_writer: dict[str, tuple[str, float]] = {}

    edges: list[Edge] = []
    for sess in sessions:
        for event in sess.memory_events:
            if event.kind != "write":
                continue
            if event.memory_id in last_writer:
                last_id, last_sal = last_writer[event.memory_id]
                edges.append(
                    Edge(
                        source=last_id,
                        target=sess.id,
                        kind="memory-share",
                        weight=min(1.0, max(last_sal, event.salience)),
                        evidence={"memory_id": event.memory_id},
                    )
                )
            last_writer[event.memory_id] = (sess.id, event.salience)
    return edges
