from datetime import UTC, datetime

from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.ingest import Session, ToolCall


def _sess(id: str, tools: list[str]) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, tzinfo=UTC),
        duration_sec=60,
        model="t",
        message_count=1,
        tool_calls=tuple(ToolCall(name=t) for t in tools),
        memory_events=(),
        search_hits=(),
    )


def test_tool_overlap_returns_edge_above_threshold() -> None:
    a = _sess("A", ["read", "edit", "bash"])
    b = _sess("B", ["read", "edit", "bash"])

    edges = detect_tool_overlap([a, b], threshold=0.4)

    assert len(edges) == 1
    e = edges[0]
    # Jaccard 3/3 = 1.0
    assert e.weight == 1.0
    assert e.kind == "tool-overlap"
    assert e.evidence["jaccard"] == 1.0


def test_tool_overlap_below_threshold_ignored() -> None:
    a = _sess("A", ["read", "edit"])
    b = _sess("B", ["bash"])

    assert detect_tool_overlap([a, b], threshold=0.4) == []


def test_tool_overlap_undirected_no_duplicates() -> None:
    a = _sess("A", ["read"])
    b = _sess("B", ["read"])

    edges = detect_tool_overlap([a, b], threshold=0.4)

    assert len(edges) == 1
    assert {edges[0].source, edges[0].target} == {"A", "B"}
