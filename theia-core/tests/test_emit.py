from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from theia_core.detect import Edge
from theia_core.emit import build_graph, write_graph
from theia_core.ingest import Session


def _sess(id: str) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, tzinfo=UTC),
        duration_sec=60.0,
        model="t",
        message_count=1,
        tool_calls=(),
        memory_events=(),
        search_hits=(),
    )


def test_build_graph_structure() -> None:
    sessions = [_sess("A"), _sess("B")]
    edges = [Edge(source="A", target="B", kind="memory-share", weight=0.5)]
    positions = np.array([[0.1, 0.2], [-0.3, 0.4]])

    g = build_graph(sessions, edges, positions, projection="pca", feature_dim=4)

    assert g["meta"]["source_count"] == 2
    assert g["meta"]["projection"] == "pca"
    assert len(g["nodes"]) == 2
    assert g["nodes"][0]["position"] == {"x": 0.1, "y": 0.2}
    assert len(g["edges"]) == 1


def test_write_graph_schema_invalid_raises(tmp_path: Path) -> None:
    bad = {"meta": {}, "nodes": [], "edges": []}
    with pytest.raises(ValueError, match="schema validation"):
        write_graph(bad, tmp_path / "out.json")


def test_write_graph_schema_valid_writes_file(tmp_path: Path) -> None:
    sessions = [_sess("A")]
    positions = np.array([[0.0, 0.0]])
    g = build_graph(sessions, [], positions, projection="pca", feature_dim=1)

    out = tmp_path / "out.json"
    write_graph(g, out)

    assert out.exists()
