from datetime import UTC, datetime

from theia_core.detect.cron import detect_cron_chain
from theia_core.ingest import Session


def _sess(
    id: str,
    cron_job_id: str | None = None,
    hour: int = 12,
    minute: int = 0,
) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, hour, minute, tzinfo=UTC),
        duration_sec=60.0,
        model="test",
        message_count=1,
        tool_calls=(),
        memory_events=(),
        search_hits=(),
        cron_job_id=cron_job_id,
    )


def test_cron_chain_links_consecutive_runs() -> None:
    a = _sess("cron_j1_001", cron_job_id="j1", minute=0)
    b = _sess("cron_j1_002", cron_job_id="j1", minute=30)

    edges = detect_cron_chain([a, b])

    assert len(edges) == 1
    e = edges[0]
    assert e.source == "cron_j1_001"
    assert e.target == "cron_j1_002"
    assert e.kind == "cron-chain"
    assert e.evidence["cron_job_id"] == "j1"


def test_cron_chain_single_session_produces_no_edge() -> None:
    a = _sess("cron_j1_001", cron_job_id="j1", minute=0)

    edges = detect_cron_chain([a])

    assert edges == []


def test_cron_chain_skips_non_cron_sessions() -> None:
    a = _sess("sess_001", cron_job_id=None, minute=0)

    edges = detect_cron_chain([a])

    assert edges == []


def test_cron_chain_ignores_sessions_from_different_jobs() -> None:
    a = _sess("cron_j1_001", cron_job_id="j1", minute=0)
    b = _sess("cron_j2_001", cron_job_id="j2", minute=5)

    edges = detect_cron_chain([a, b])

    assert edges == []


def test_cron_chain_multiple_consecutive_pairs() -> None:
    a = _sess("cron_j1_001", cron_job_id="j1", minute=0)
    b = _sess("cron_j1_002", cron_job_id="j1", minute=30)
    c = _sess("cron_j1_003", cron_job_id="j1", hour=13, minute=0)

    edges = detect_cron_chain([a, b, c])

    assert len(edges) == 2
    assert edges[0].source == "cron_j1_001"
    assert edges[0].target == "cron_j1_002"
    assert edges[1].source == "cron_j1_002"
    assert edges[1].target == "cron_j1_003"


def test_cron_chain_weight_decreases_with_larger_gap() -> None:
    close_a = _sess("cron_j1_001", cron_job_id="j1", minute=0)
    close_b = _sess("cron_j1_002", cron_job_id="j1", minute=1)
    far_a = _sess("cron_j2_001", cron_job_id="j2", hour=12, minute=0)
    far_b = _sess("cron_j2_002", cron_job_id="j2", hour=14, minute=0)

    close = detect_cron_chain([close_a, close_b])[0]
    far = detect_cron_chain([far_a, far_b])[0]

    assert close.weight > far.weight
