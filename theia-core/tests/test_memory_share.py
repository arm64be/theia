from datetime import UTC, datetime

from theia_core.detect.memory_share import detect_memory_share
from theia_core.ingest import MemoryEvent, Session


def _sess(id: str, events: list[MemoryEvent], minute: int) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, 12, minute, tzinfo=UTC),
        duration_sec=60.0,
        model="test",
        message_count=1,
        tool_calls=(),
        memory_events=tuple(events),
        search_hits=(),
    )


def test_memory_share_co_write_yields_edge() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.9)], minute=0)
    b = _sess("B", [MemoryEvent(kind="write", memory_id="m1", salience=0.5)], minute=5)

    edges = detect_memory_share([a, b])

    assert len(edges) == 1
    e = edges[0]
    assert e.kind == "memory-share"
    assert e.evidence["memory_id"] == "m1"


def test_memory_share_ignores_reads() -> None:
    """Read-based linking is disabled; only writes create edges."""
    writer = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.9)], minute=0)
    reader = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=5)

    edges = detect_memory_share([writer, reader])

    assert edges == []


def test_memory_share_no_edge_without_match() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1")], minute=0)
    b = _sess("B", [MemoryEvent(kind="write", memory_id="m99")], minute=5)

    assert detect_memory_share([a, b]) == []


def test_memory_share_weight_uses_salience() -> None:
    low_a = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.1)], minute=0)
    low_b = _sess("B", [MemoryEvent(kind="write", memory_id="m1", salience=0.1)], minute=5)
    high_a = _sess("A2", [MemoryEvent(kind="write", memory_id="m2", salience=1.0)], minute=0)
    high_b = _sess("B2", [MemoryEvent(kind="write", memory_id="m2", salience=1.0)], minute=5)

    low = detect_memory_share([low_a, low_b])[0]
    high = detect_memory_share([high_a, high_b])[0]

    assert high.weight > low.weight
