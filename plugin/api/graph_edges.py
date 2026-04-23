"""Theia Constellation — edge construction and deduplication.

Edges encode relationships between session nodes:
  - cross-search: sessions from the same source (temporal proximity)
  - tool-overlap:  sessions sharing the same model/tooling
"""

from __future__ import annotations


def build_edges(
    nodes: list[dict],
    source_groups: dict[str, list[int]],
    model_groups: dict[str, list[int]],
) -> list[dict]:
    """Build and deduplicate edges from grouping indices.

    Constructs edges directly into a deduplication dict to avoid
    building a throwaway list and scanning it a second time.
    """
    # Use a dict keyed on normalised (sorted) source-target pair for
    # single-pass deduplication — O(E) instead of O(2E).
    seen: dict[tuple[str, str], dict] = {}

    def _add_edge(src_id: str, tgt_id: str, kind: str, weight: float) -> None:
        key = (src_id, tgt_id) if src_id <= tgt_id else (tgt_id, src_id)
        existing = seen.get(key)
        if existing is None or weight > existing["weight"]:
            seen[key] = {
                "source": src_id,
                "target": tgt_id,
                "kind": kind,
                "weight": weight,
            }

    # Temporal proximity within the same source -> "cross-search"
    for idxs in source_groups.values():
        for i in range(len(idxs) - 1):
            _add_edge(
                nodes[idxs[i]]["id"],
                nodes[idxs[i + 1]]["id"],
                "cross-search",
                0.4,
            )

    # Shared model -> "tool-overlap" (sequential pairs + sparse skip links)
    for idxs in model_groups.values():
        if len(idxs) < 2:
            continue
        for i in range(len(idxs) - 1):
            _add_edge(
                nodes[idxs[i]]["id"],
                nodes[idxs[i + 1]]["id"],
                "tool-overlap",
                0.15,
            )
            # Sparse skip-2 connections every 3rd pair for local clustering
            if i + 2 < len(idxs) and i % 3 == 0:
                _add_edge(
                    nodes[idxs[i]]["id"],
                    nodes[idxs[i + 2]]["id"],
                    "tool-overlap",
                    0.08,
                )

    return list(seen.values())
