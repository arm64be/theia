from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class MemoryEvent:
    kind: str               # "write" | "read"
    memory_id: str
    salience: float = 0.5
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCall:
    name: str
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchHit:
    query: str
    source_session_id: str   # session whose artifact was hit
    hit_rank: int
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Session:
    id: str
    title: str
    started_at: datetime
    duration_sec: float
    model: str
    message_count: int
    tool_calls: tuple[ToolCall, ...]
    memory_events: tuple[MemoryEvent, ...]
    search_hits: tuple[SearchHit, ...]
    raw: dict[str, Any] = field(default_factory=dict)


import json
from pathlib import Path


def _parse_iso(s: str) -> datetime:
    # Python 3.11 handles "Z" suffix in fromisoformat
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def parse_session(path: Path) -> Session:
    data = json.loads(Path(path).read_text())
    return Session(
        id=data["id"],
        title=data.get("title", ""),
        started_at=_parse_iso(data["started_at"]),
        duration_sec=float(data.get("duration_sec", 0.0)),
        model=data.get("model", "unknown"),
        message_count=int(data.get("message_count", 0)),
        tool_calls=tuple(ToolCall(name=t["name"], raw=t) for t in data.get("tool_calls", [])),
        memory_events=tuple(
            MemoryEvent(
                kind=m["kind"],
                memory_id=m["memory_id"],
                salience=float(m.get("salience", 0.5)),
                raw=m,
            )
            for m in data.get("memory_events", [])
        ),
        search_hits=tuple(
            SearchHit(
                query=s["query"],
                source_session_id=s["source_session_id"],
                hit_rank=int(s.get("hit_rank", 0)),
                raw=s,
            )
            for s in data.get("search_hits", [])
        ),
        raw=data,
    )


def load_sessions(directory: Path) -> list[Session]:
    directory = Path(directory)
    return [parse_session(p) for p in sorted(directory.glob("*.json"))]
