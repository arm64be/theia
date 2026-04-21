from datetime import UTC, datetime

from theia_core.detect.cross_search import detect_cross_search
from theia_core.ingest import SearchHit, Session


def _sess(id: str, hits: list[SearchHit]) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, tzinfo=UTC),
        duration_sec=60,
        model="t",
        message_count=1,
        tool_calls=(),
        memory_events=(),
        search_hits=tuple(hits),
    )


def test_cross_search_creates_edge_from_source_to_searcher() -> None:
    a = _sess("A", [])
    b = _sess("B", [SearchHit(query="q", source_session_id="A", hit_rank=1)])

    edges = detect_cross_search([a, b])

    assert len(edges) == 1
    e = edges[0]
    assert e.source == "A"
    assert e.target == "B"
    assert e.kind == "cross-search"
    assert e.evidence["query"] == "q"


def test_cross_search_weight_decreases_with_rank() -> None:
    a = _sess("A", [])
    top = _sess("B", [SearchHit(query="q", source_session_id="A", hit_rank=1)])
    bottom = _sess("C", [SearchHit(query="q", source_session_id="A", hit_rank=10)])

    e_top = detect_cross_search([a, top])[0]
    e_bot = detect_cross_search([a, bottom])[0]

    assert e_top.weight > e_bot.weight


def test_cross_search_ignores_self_hits() -> None:
    a = _sess("A", [SearchHit(query="q", source_session_id="A", hit_rank=1)])

    assert detect_cross_search([a]) == []
