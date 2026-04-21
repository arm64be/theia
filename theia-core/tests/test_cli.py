import json
import subprocess
import sys
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_cli_produces_valid_graph(tmp_path: Path) -> None:
    out = tmp_path / "graph.json"
    result = subprocess.run(
        [sys.executable, "-m", "theia_core", str(FIXTURE), "-o", str(out)],
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
