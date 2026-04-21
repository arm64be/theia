from datetime import datetime, timezone

import numpy as np

from theia_core.features import build_feature_matrix
from theia_core.ingest import MemoryEvent, Session, ToolCall


def _sess(id: str, tools: list[str], memories: list[str]) -> Session:
    return Session(
        id=id, title=id,
        started_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        duration_sec=60, model="t", message_count=1,
        tool_calls=tuple(ToolCall(name=t) for t in tools),
        memory_events=tuple(MemoryEvent(kind="write", memory_id=m) for m in memories),
        search_hits=(),
    )


def test_build_feature_matrix_shape_and_normalization() -> None:
    a = _sess("A", ["read", "bash"], ["m1"])
    b = _sess("B", ["read"], ["m2"])

    matrix, names = build_feature_matrix([a, b])

    assert matrix.shape[0] == 2
    assert matrix.shape[1] == len(names)
    # Row norms should be 1 (L2) for non-empty sessions
    assert np.allclose(np.linalg.norm(matrix, axis=1), 1.0)
    # Vocab ordering is deterministic
    assert "tool:bash" in names
    assert "mem:m1" in names
