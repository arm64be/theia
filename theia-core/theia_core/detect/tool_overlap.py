from __future__ import annotations

from itertools import combinations
from typing import Iterable

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_tool_overlap(sessions: Iterable[Session], threshold: float = 0.4) -> list[Edge]:
    sessions = list(sessions)
    tool_sets: dict[str, set[str]] = {
        s.id: {t.name for t in s.tool_calls} for s in sessions
    }
    edges: list[Edge] = []
    for a, b in combinations(sorted(tool_sets), 2):
        ts_a = tool_sets[a]
        ts_b = tool_sets[b]
        union = ts_a | ts_b
        if not union:
            continue
        jacc = len(ts_a & ts_b) / len(union)
        if jacc < threshold:
            continue
        edges.append(
            Edge(
                source=a,
                target=b,
                kind="tool-overlap",
                weight=jacc,
                evidence={"jaccard": jacc, "shared_tools": sorted(ts_a & ts_b)},
            )
        )
    return edges
