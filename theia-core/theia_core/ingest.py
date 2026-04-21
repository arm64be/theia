from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class MemoryEvent:
    kind: str  # "write" | "read"
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
    source_session_id: str  # session whose artifact was hit
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


def _parse_iso(s: str) -> datetime:
    s = s.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _extract_tool_calls_from_messages(messages: list[dict[str, Any]]) -> list[ToolCall]:
    """Pull tool calls out of assistant messages in Hermes JSONL format."""
    calls: list[ToolCall] = []
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            calls.append(ToolCall(name=fn.get("name", "unknown"), raw=tc))
    return calls


def _infer_memory_events(tool_calls: list[ToolCall]) -> list[MemoryEvent]:
    """Heuristic: treat 'memory' tool calls as memory events."""
    events: list[MemoryEvent] = []
    for tc in tool_calls:
        if tc.name != "memory":
            continue
        fn = tc.raw.get("function", {})
        args_str = fn.get("arguments", "{}")
        try:
            args = json.loads(args_str) if isinstance(args_str, str) else args_str
        except json.JSONDecodeError:
            args = {}
        action = str(args.get("action", "")).lower()
        kind = "write" if action in ("write", "store", "save") else "read"
        mem_id = str(args.get("memory_id", args.get("id", "unknown")))
        events.append(MemoryEvent(kind=kind, memory_id=mem_id, raw=tc.raw))
    return events


def _infer_search_hits(tool_calls: list[ToolCall], session_id: str) -> list[SearchHit]:
    """Heuristic: treat cross-session search tool calls as search hits."""
    hits: list[SearchHit] = []
    for tc in tool_calls:
        if tc.name not in ("session_search",):
            continue
        fn = tc.raw.get("function", {})
        args_str = fn.get("arguments", "{}")
        try:
            args = json.loads(args_str) if isinstance(args_str, str) else args_str
        except json.JSONDecodeError:
            args = {}
        query = str(args.get("query", ""))
        source = str(args.get("source_session_id", ""))
        if not source:
            continue
        hits.append(
            SearchHit(
                query=query,
                source_session_id=source,
                hit_rank=1,
                raw=tc.raw,
            )
        )
    return hits


def _parse_json(path: Path) -> Session:
    data = json.loads(path.read_text())
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


def _parse_jsonl(path: Path) -> Session:
    lines = path.read_text().strip().splitlines()
    if not lines:
        raise ValueError(f"empty JSONL file: {path}")

    meta = json.loads(lines[0])
    messages = [json.loads(line) for line in lines[1:] if line.strip()]

    session_id = path.stem
    model = meta.get("model") or "unknown"

    # Derive timing from message timestamps
    timestamps: list[datetime] = []
    for m in messages:
        ts = m.get("timestamp")
        if ts:
            timestamps.append(_parse_iso(ts))
    if meta.get("timestamp"):
        timestamps.append(_parse_iso(meta["timestamp"]))

    started_at = min(timestamps) if timestamps else datetime.now(UTC)
    ended_at = max(timestamps) if timestamps else started_at
    duration_sec = (ended_at - started_at).total_seconds()

    tool_calls = _extract_tool_calls_from_messages(messages)
    memory_events = _infer_memory_events(tool_calls)
    search_hits = _infer_search_hits(tool_calls, session_id)

    return Session(
        id=session_id,
        title=session_id,
        started_at=started_at,
        duration_sec=duration_sec,
        model=model,
        message_count=len(messages),
        tool_calls=tuple(tool_calls),
        memory_events=tuple(memory_events),
        search_hits=tuple(search_hits),
        raw={"meta": meta, "messages": messages},
    )


def parse_session(path: Path) -> Session:
    path = Path(path)
    if path.suffix == ".jsonl":
        return _parse_jsonl(path)
    return _parse_json(path)


def load_sessions(directory: Path) -> list[Session]:
    directory = Path(directory)
    paths = sorted(directory.glob("*.json")) + sorted(directory.glob("*.jsonl"))
    sessions: list[Session] = []
    for p in paths:
        try:
            sessions.append(parse_session(p))
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            import warnings

            warnings.warn(f"skipping {p.name}: {exc}", stacklevel=2)
    return sessions
