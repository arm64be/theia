"""Per-node graph topology metadata.

Computes six fields for every session node from the candidate edge list:

* ``component_id``      — connected-component ID (only assigned to components
  larger than three nodes; smaller components are ``None``).
* ``hub_score``         — ``1.0`` if degree exceeds ``mean + 2*std`` or
  ``>= 10``; otherwise ``0.0``.
* ``hierarchy_depth``   — distance from the subagent-tree root (roots = 0).
* ``descendant_count``  — number of transitive subagent descendants.
* ``is_orphan``         — degree across **all** edge kinds is zero.
* ``cron_sequence_id``  — sequence ID for chains of ``cron-chain`` edges
  whose consecutive runs are within 48h of each other.

The detector runs against the full session universe so its output stays in
sync with the edge-validation step in :func:`theia_core.emit.build_graph`.
No new dependencies — pure Python collections.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
from typing import Any

from theia_core.detect import Edge
from theia_core.ingest import Session

_HUB_DEGREE_FLOOR = 10
_HUB_STD_MULTIPLIER = 2.0
_MIN_LABELED_COMPONENT_SIZE = 4  # spec: only components with > 3 nodes get an id
_CRON_GAP_HOURS = 48.0


def _undirected_adjacency(
    node_ids: set[str],
    edges: list[Edge],
    kinds: set[str] | None = None,
) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = {nid: set() for nid in node_ids}
    for e in edges:
        if kinds is not None and e.kind not in kinds:
            continue
        if e.source not in node_ids or e.target not in node_ids:
            continue
        if e.source == e.target:
            continue
        adj[e.source].add(e.target)
        adj[e.target].add(e.source)
    return adj


def _bfs_components(adj: dict[str, set[str]]) -> list[list[str]]:
    seen: set[str] = set()
    out: list[list[str]] = []
    for start in sorted(adj):
        if start in seen:
            continue
        comp: list[str] = []
        q: deque[str] = deque([start])
        seen.add(start)
        while q:
            cur = q.popleft()
            comp.append(cur)
            for nxt in adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    q.append(nxt)
        out.append(comp)
    return out


def _component_ids(adj: dict[str, set[str]]) -> dict[str, int | None]:
    """Assign contiguous IDs to components with more than 3 nodes."""
    comps = _bfs_components(adj)
    # Larger first, lex-min as tiebreaker → deterministic across runs.
    comps.sort(key=lambda c: (-len(c), min(c)))
    out: dict[str, int | None] = {}
    next_id = 0
    for comp in comps:
        cid: int | None
        if len(comp) >= _MIN_LABELED_COMPONENT_SIZE:
            cid = next_id
            next_id += 1
        else:
            cid = None
        for n in comp:
            out[n] = cid
    return out


def _hub_scores(adj: dict[str, set[str]]) -> dict[str, float]:
    if not adj:
        return {}
    degrees = {n: len(neigh) for n, neigh in adj.items()}
    vals = list(degrees.values())
    n = len(vals)
    mean = sum(vals) / n
    var = sum((d - mean) ** 2 for d in vals) / n
    std = math.sqrt(var)
    threshold = mean + _HUB_STD_MULTIPLIER * std
    out: dict[str, float] = {}
    for node, deg in degrees.items():
        is_hub = deg >= _HUB_DEGREE_FLOOR or (std > 0 and deg > threshold)
        out[node] = 1.0 if is_hub else 0.0
    return out


def _subagent_tree_metrics(
    node_ids: set[str], edges: list[Edge]
) -> tuple[dict[str, int], dict[str, int]]:
    """Return ``(hierarchy_depth, descendant_count)`` per node.

    Subagent edges are parent → child (see :mod:`theia_core.detect.subagent`).
    Nodes outside any subagent tree get depth 0 and 0 descendants.
    """
    children: dict[str, set[str]] = defaultdict(set)
    has_parent: set[str] = set()
    for e in edges:
        if e.kind != "subagent":
            continue
        if e.source not in node_ids or e.target not in node_ids:
            continue
        if e.source == e.target:
            continue
        children[e.source].add(e.target)
        has_parent.add(e.target)

    roots = [n for n in node_ids if n not in has_parent]
    depth: dict[str, int] = dict.fromkeys(node_ids, 0)
    desc: dict[str, int] = dict.fromkeys(node_ids, 0)

    for root in roots:
        # BFS to assign depth and capture traversal order for the post-order
        # descendant count.
        order: list[str] = []
        visited = {root}
        q: deque[tuple[str, int]] = deque([(root, 0)])
        while q:
            cur, d = q.popleft()
            depth[cur] = d
            order.append(cur)
            for child in children.get(cur, ()):
                if child in visited:
                    continue
                visited.add(child)
                q.append((child, d + 1))
        for node in reversed(order):
            total = 0
            for child in children.get(node, ()):
                total += 1 + desc[child]
            desc[node] = total

    return depth, desc


def _cron_sequence_ids(node_ids: set[str], edges: list[Edge]) -> dict[str, int | None]:
    """Group cron-chain edges with gap ≤ 48h into connected sequences."""
    cron_adj: dict[str, set[str]] = {nid: set() for nid in node_ids}
    for e in edges:
        if e.kind != "cron-chain":
            continue
        if e.source not in node_ids or e.target not in node_ids:
            continue
        if e.source == e.target:
            continue
        gap = (e.evidence or {}).get("interval_hours")
        # Missing gap means the chain detector still grouped them together,
        # so trust it rather than dropping the edge.
        if isinstance(gap, (int, float)) and gap > _CRON_GAP_HOURS:
            continue
        cron_adj[e.source].add(e.target)
        cron_adj[e.target].add(e.source)

    out: dict[str, int | None] = dict.fromkeys(node_ids, None)
    seen: set[str] = set()
    next_id = 0
    for start in sorted(node_ids):
        if start in seen or not cron_adj[start]:
            continue
        comp: list[str] = []
        q: deque[str] = deque([start])
        seen.add(start)
        while q:
            cur = q.popleft()
            comp.append(cur)
            for nxt in cron_adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    q.append(nxt)
        if len(comp) >= 2:
            for n in comp:
                out[n] = next_id
            next_id += 1
    return out


def detect_topology(sessions: list[Session], edges: list[Edge]) -> dict[str, dict[str, Any]]:
    """Compute per-node topology metadata.

    Returns a mapping ``{node_id: metadata_dict}`` where every value contains
    the six fields documented at the top of this module.
    """
    node_ids = {s.id for s in sessions}
    full_adj = _undirected_adjacency(node_ids, edges)

    components = _component_ids(full_adj)
    hubs = _hub_scores(full_adj)
    depth, descendants = _subagent_tree_metrics(node_ids, edges)
    cron_ids = _cron_sequence_ids(node_ids, edges)

    metadata: dict[str, dict[str, Any]] = {}
    for nid in node_ids:
        deg = len(full_adj.get(nid, ()))
        metadata[nid] = {
            "component_id": components.get(nid),
            "hub_score": hubs.get(nid, 0.0),
            "hierarchy_depth": depth.get(nid, 0),
            "descendant_count": descendants.get(nid, 0),
            "is_orphan": deg == 0,
            "cron_sequence_id": cron_ids.get(nid),
        }
    return metadata
