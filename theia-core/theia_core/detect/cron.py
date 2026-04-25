from __future__ import annotations

from collections import defaultdict

from theia_core.detect import Edge
from theia_core.ingest import Session

# Cron-chain edge weights decay with the gap between consecutive runs:
#   weight = 1 / (1 + hours * _FALLOFF_PER_HOUR), clamped to [_MIN_WEIGHT, 1.0]
# With the current values this falls to ~0.5 over 10h, ~0.3 over 24h, and
# floors at 0.1 for very long gaps.
_FALLOFF_PER_HOUR = 0.1
_MIN_WEIGHT = 0.1


def detect_cron_chain(sessions: list[Session]) -> list[Edge]:
    """Create edges between consecutive runs of the same cron job.

    Sessions spawned by the same cron job are grouped by ``cron_job_id``,
    sorted chronologically, and an edge is created between each consecutive
    pair.  This lets users visually trace recurring task lineages.
    """
    by_job: dict[str, list[Session]] = defaultdict(list)
    for sess in sessions:
        if sess.cron_job_id:
            by_job[sess.cron_job_id].append(sess)

    edges: list[Edge] = []
    for job_id, group in by_job.items():
        group.sort(key=lambda s: s.started_at)
        for prev_sess, next_sess in zip(group, group[1:]):
            hours = (next_sess.started_at - prev_sess.started_at).total_seconds() / 3600
            weight = max(_MIN_WEIGHT, min(1.0, 1.0 / (1.0 + hours * _FALLOFF_PER_HOUR)))
            edges.append(
                Edge(
                    source=prev_sess.id,
                    target=next_sess.id,
                    kind="cron-chain",
                    weight=weight,
                    evidence={
                        "cron_job_id": job_id,
                        "interval_hours": round(hours, 2),
                    },
                )
            )
    return edges
