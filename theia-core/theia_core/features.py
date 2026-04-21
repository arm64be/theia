from __future__ import annotations

from collections import Counter

import numpy as np

from theia_core.ingest import Session


def build_feature_matrix(sessions: list[Session]) -> tuple[np.ndarray, list[str]]:
    """Returns (matrix of shape (n_sessions, n_features), feature_names)."""
    tool_vocab = sorted({t.name for s in sessions for t in s.tool_calls})
    # memory tag vocab: memory IDs touched (write or read)
    memory_vocab = sorted({m.memory_id for s in sessions for m in s.memory_events})

    feature_names: list[str] = []
    feature_names += [f"tool:{t}" for t in tool_vocab]
    feature_names += [f"mem:{m}" for m in memory_vocab]

    rows = []
    for s in sessions:
        tool_counts = Counter(t.name for t in s.tool_calls)
        mem_touched = {m.memory_id for m in s.memory_events}
        row = [float(tool_counts.get(t, 0)) for t in tool_vocab] + [
            1.0 if m in mem_touched else 0.0 for m in memory_vocab
        ]
        rows.append(row)

    matrix = np.asarray(rows, dtype=float)
    # L2-normalize rows so projection isn't dominated by long sessions
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms
    return matrix, feature_names
