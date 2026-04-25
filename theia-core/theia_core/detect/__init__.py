from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

EdgeKind = Literal["memory-share", "cross-search", "tool-overlap", "subagent", "cron-chain"]


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    kind: EdgeKind
    weight: float  # 0..1
    evidence: dict[str, Any] = field(default_factory=dict)
