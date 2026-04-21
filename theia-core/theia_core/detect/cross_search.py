from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_cross_search(sessions: Iterable[Session]) -> list[Edge]:
    by_pair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for sess in sessions:
        for hit in sess.search_hits:
            if not hit.source_session_id or hit.source_session_id == sess.id:
                continue
            by_pair[(hit.source_session_id, sess.id)].append(
                {"query": hit.query, "hit_rank": hit.hit_rank}
            )

    edges: list[Edge] = []
    for (src, tgt), hits in by_pair.items():
        # weight: average of 1 / rank across hits; clamp to (0,1]
        inv_ranks = [1.0 / max(h["hit_rank"], 1) for h in hits]
        weight = sum(inv_ranks) / len(inv_ranks)
        # favor the top hit as the representative evidence
        top = min(hits, key=lambda h: h["hit_rank"])
        edges.append(
            Edge(
                source=src,
                target=tgt,
                kind="cross-search",
                weight=min(1.0, weight),
                evidence={"query": top["query"], "hit_rank": top["hit_rank"], "hits": len(hits)},
            )
        )
    return edges
