from __future__ import annotations

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_subagent(sessions: list[Session]) -> list[Edge]:
    """Create edges between parent sessions and their subagent children."""
    edges: list[Edge] = []
    for sess in sessions:
        if sess.parent_id:
            edges.append(
                Edge(
                    source=sess.parent_id,
                    target=sess.id,
                    kind="subagent",
                    weight=1.0,
                    evidence={"child_session_id": sess.id},
                )
            )
    return edges
