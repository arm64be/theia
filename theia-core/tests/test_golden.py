from pathlib import Path

from theia_core.detect.memory_share import detect_memory_share
from theia_core.ingest import load_sessions

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_golden_memory_share_alpha_to_beta() -> None:
    sessions = load_sessions(FIXTURE_DIR)
    edges = detect_memory_share(sessions)

    memory_edges = [e for e in edges if e.kind == "memory-share"]
    assert len(memory_edges) == 1
    e = memory_edges[0]
    assert e.source == "sess_alpha"
    assert e.target == "sess_beta"
    assert e.evidence["read_count"] == 2
    assert 0 < e.weight <= 1
