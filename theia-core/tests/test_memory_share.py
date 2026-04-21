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


def test_memory_share_writer_before_reader_yields_edge() -> None:
    writer = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.9)], minute=0)
    reader = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=5)

    edges = detect_memory_share([writer, reader])

    assert len(edges) == 1
    e = edges[0]
    assert e.source == "A" and e.target == "B"
    assert e.kind == "memory-share"
    assert 0 < e.weight <= 1
    assert e.evidence["memory_id"] == "m1"


def test_memory_share_ignores_when_reader_before_writer() -> None:
    reader = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=0)
    writer = _sess("A", [MemoryEvent(kind="write", memory_id="m1")], minute=5)

    assert detect_memory_share([reader, writer]) == []


def test_memory_share_no_edge_without_match() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1")], minute=0)
    b = _sess("B", [MemoryEvent(kind="read", memory_id="m99")], minute=5)

    assert detect_memory_share([a, b]) == []


def test_memory_share_weight_scales_with_salience_and_read_count() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.1)], minute=0)
    b1 = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=5)
    a2 = _sess("A2", [MemoryEvent(kind="write", memory_id="m2", salience=1.0)], minute=0)
    b2 = _sess(
        "B2",
        [
            MemoryEvent(kind="read", memory_id="m2"),
            MemoryEvent(kind="read", memory_id="m2"),
        ],
        minute=5,
    )

    low = detect_memory_share([a, b1])[0]
    high = detect_memory_share([a2, b2])[0]

    assert high.weight > low.weight
