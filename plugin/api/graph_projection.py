"""Theia Constellation — 2D position projection via PCA-like variance axes.

Computes a lightweight dimensionality reduction:
  1. Build a normalised feature vector per node.
  2. Center the feature matrix.
  3. Pick the two dimensions with the highest variance.
  4. Add golden-angle jitter to prevent overlapping positions.
  5. Normalise to [-1, 1].
"""

from __future__ import annotations

from .graph_utils import hash_to_float, jitter_pair

# Feature vector indices (for readability)
_F_MSGS = 0
_F_TOOLS = 1
_F_DUR = 2
_F_MODEL = 3
_F_DATE = 4
_FEATURE_DIM = 5


def compute_positions(nodes: list[dict]) -> None:
    """Mutate ``nodes`` in-place, setting each node's ``position`` dict.

    Each node must already have: message_count, tool_count, duration_sec,
    model, started_at.
    """
    n = len(nodes)
    if n == 0:
        return

    # ------------------------------------------------------------------
    # Build normalised feature matrix in a single pass over nodes
    # ------------------------------------------------------------------
    max_msgs = 1
    max_tools = 1
    max_dur = 1.0
    for nd in nodes:
        if nd["message_count"] > max_msgs:
            max_msgs = nd["message_count"]
        if nd["tool_count"] > max_tools:
            max_tools = nd["tool_count"]
        if nd["duration_sec"] > max_dur:
            max_dur = nd["duration_sec"]

    features: list[list[float]] = []
    for nd in nodes:
        features.append(
            [
                nd["message_count"] / max_msgs,
                nd["tool_count"] / max_tools,
                nd["duration_sec"] / max_dur,
                hash_to_float(nd["model"]),
                hash_to_float(nd["started_at"][:10]),
            ]
        )

    # ------------------------------------------------------------------
    # Center features and compute per-dimension variance
    # ------------------------------------------------------------------
    inv_n = 1.0 / n
    means = [0.0] * _FEATURE_DIM
    for f in features:
        for d in range(_FEATURE_DIM):
            means[d] += f[d]
    for d in range(_FEATURE_DIM):
        means[d] *= inv_n

    # Center in-place and accumulate variance simultaneously
    variances = [0.0] * _FEATURE_DIM
    for f in features:
        for d in range(_FEATURE_DIM):
            f[d] -= means[d]
            variances[d] += f[d] * f[d]

    # ------------------------------------------------------------------
    # Pick top-2 variance dimensions
    # ------------------------------------------------------------------
    sorted_dims = sorted(range(_FEATURE_DIM), key=lambda d: -variances[d])
    d1, d2 = sorted_dims[0], sorted_dims[1]

    # ------------------------------------------------------------------
    # Project + jitter + normalise
    # ------------------------------------------------------------------
    xs = [f[d1] for f in features]
    ys = [f[d2] for f in features]

    for i in range(n):
        jx, jy = jitter_pair(i)
        xs[i] += jx
        ys[i] += jy

    max_x = max(abs(v) for v in xs) or 1.0
    max_y = max(abs(v) for v in ys) or 1.0
    inv_max_x = 1.0 / max_x
    inv_max_y = 1.0 / max_y

    for i in range(n):
        nodes[i]["position"] = {
            "x": round(xs[i] * inv_max_x, 6),
            "y": round(ys[i] * inv_max_y, 6),
        }
