from pathlib import Path

from theia_core.detect.memory_share import detect_memory_share
from theia_core.ingest import load_sessions
from tests.db_helpers import seed_test_db

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_golden_memory_share_alpha_to_beta(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    seed_test_db(db, FIXTURE_DIR)
    sessions = load_sessions(db)
    edges = detect_memory_share(sessions)

    memory_edges = [e for e in edges if e.kind == "memory-share"]
    assert len(memory_edges) == 1
    e = memory_edges[0]
    assert {e.source, e.target} == {"sess_alpha", "sess_beta"}
    assert e.evidence["memory_id"] == "mem_auth_design"
    assert 0 < e.weight <= 1
