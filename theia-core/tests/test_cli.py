import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from tests.db_helpers import seed_test_db
from theia_core.__main__ import main

FIXTURE = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_cli_produces_valid_graph(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    out = tmp_path / "graph.json"
    seed_test_db(db, FIXTURE)

    result = subprocess.run(
        [sys.executable, "-m", "theia_core", "--db-path", str(db), "-o", str(out)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "wrote" in result.stdout

    graph = json.loads(out.read_text())
    assert graph["meta"]["source_count"] == 3
    assert len(graph["nodes"]) == 3
    # Should have at least one memory-share edge (alpha → beta)
    kinds = {e["kind"] for e in graph["edges"]}
    assert "memory-share" in kinds


def test_cli_watch_flag_invokes_watcher(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    out = tmp_path / "graph.json"
    seed_test_db(db, FIXTURE)
    watch_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def fake_watch_db(*args: object, **kwargs: object) -> None:
        watch_calls.append((args, kwargs))

    with patch("theia_core.__main__.watch_db", fake_watch_db):
        rc = main(["--db-path", str(db), "-o", str(out), "--watch"])

    assert rc == 0
    assert len(watch_calls) == 1
    assert watch_calls[0][1].get("interval") == 1.0
