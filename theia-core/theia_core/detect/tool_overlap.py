from __future__ import annotations

from collections.abc import Iterable
from itertools import combinations

from theia_core.detect import Edge
from theia_core.ingest import Session


# Generic infrastructure tools that appear in most sessions and don't indicate real similarity.
_GENERIC_TOOLS = frozenset({"terminal", "read_file", "write_file", "patch", "search_files", "process", "execute_code", "todo", "cronjob"})


def detect_tool_overlap(sessions: Iterable[Session], threshold: float = 0.8) -> list[Edge]:
    sessions = list(sessions)
    tool_sets: dict[str, set[str]] = {
        s.id: {t.name for t in s.tool_calls if t.name not in _GENERIC_TOOLS} for s in sessions
    }
    edges: list[Edge] = []
    for a, b in combinations(sorted(tool_sets), 2):
        ts_a = tool_sets[a]
        ts_b = tool_sets[b]
        union = ts_a | ts_b
        if not union:
            continue
        shared = ts_a & ts_b
        if len(shared) < 2:
            continue
        jacc = len(shared) / len(union)
        if jacc < threshold:
            continue
        edges.append(
            Edge(
                source=a,
                target=b,
                kind="tool-overlap",
                weight=jacc,
                evidence={"jaccard": jacc, "shared_tools": sorted(shared)},
            )
        )
    return edges
