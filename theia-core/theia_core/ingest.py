from __future__ import annotations

import json
import sqlite3
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
    preview: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
    parent_id: str | None = None
    cron_job_id: str | None = None


def _parse_iso(s: str) -> datetime:
    s = s.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _datetime_from_timestamp(ts: float | None) -> datetime:
    if ts is None:
        return datetime.now(UTC)
    return datetime.fromtimestamp(ts, tz=UTC)


def _extract_tool_calls_from_messages(messages: list[dict[str, Any]]) -> list[ToolCall]:
    """Pull tool calls out of assistant messages."""
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
    import hashlib

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
        write_actions = {"write", "store", "save", "add", "replace", "remove"}
        has_content = "content" in args or "old_text" in args
        kind = "write" if (action in write_actions) or (not action and has_content) else "read"

        mem_id = str(args.get("memory_id", args.get("id", args.get("target", ""))))
        if not mem_id:
            content = ""
            if action in ("add", "replace") and "content" in args:
                content = str(args["content"])
            elif action in ("replace", "remove") and "old_text" in args:
                content = str(args["old_text"])
            elif "content" in args:
                content = str(args["content"])
            elif "old_text" in args:
                content = str(args["old_text"])
            mem_id = hashlib.sha256(content.encode()).hexdigest()[:16] if content else "unknown"
        events.append(MemoryEvent(kind=kind, memory_id=mem_id, raw=tc.raw))
    return events


def _infer_search_hits(
    tool_calls: list[ToolCall],
    session_id: str,
    messages: list[dict[str, Any]],
) -> list[SearchHit]:
    """Heuristic: treat cross-session search tool calls as search hits."""
    responses: dict[str, dict[str, Any]] = {}
    for msg in messages:
        if msg.get("role") != "tool":
            continue
        tc_id = msg.get("tool_call_id", "")
        if not tc_id:
            continue
        content = msg.get("content", "")
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except json.JSONDecodeError:
                content = {}
        if isinstance(content, dict):
            responses[tc_id] = content

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
            resp = responses.get(tc.raw.get("id", tc.raw.get("call_id", "")), {})
            for result in resp.get("results", []):
                sid = str(result.get("session_id", ""))
                if sid and sid != session_id:
                    hits.append(
                        SearchHit(
                            query=query,
                            source_session_id=sid,
                            hit_rank=1,
                            raw=tc.raw,
                        )
                    )
            continue
        if source == session_id:
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


PREVIEW_TRUNCATION = 60


def _build_preview(messages: list[dict[str, Any]]) -> str:
    """Return truncated first user message (see PREVIEW_TRUNCATION)."""
    for msg in messages:
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                stripped = content.strip()
                text = stripped[:PREVIEW_TRUNCATION]
                return text + ("..." if len(stripped) > PREVIEW_TRUNCATION else "")
    return ""


def _extract_cron_job_id(session_id: str) -> str | None:
    """Extract cron job ID from a cron-spawned session ID.

    Cron session IDs follow the pattern
    ``cron_<job_id>_<YYYYMMDD>_<HHMMSS>``,
    e.g. ``cron_8974a4d0b3cc_20260330_171037`` -> ``8974a4d0b3cc``.

    Uses ``rsplit`` from the right so that the job ID itself may
    contain underscores (e.g. ``cron_my_job_20260330_171037`` ->
    ``my_job``).  Returns ``None`` if the trailing date/time segments
    are missing or malformed.
    """
    if not session_id.startswith("cron_"):
        return None
    rest = session_id[len("cron_") :]
    parts = rest.rsplit("_", 2)
    if len(parts) != 3:
        return None
    job_id, date_part, time_part = parts
    if not (
        len(date_part) == 8 and date_part.isdigit() and len(time_part) == 6 and time_part.isdigit()
    ):
        return None
    return job_id or None


def load_sessions(db_path: Path, include_children: bool = True) -> list[Session]:
    """Load sessions from a Hermes SQLite database.

    Queries ``sessions`` and ``messages`` tables, extracting tool calls,
    memory events, search hits, and preview text.

    Parameters
    ----------
    include_children:
        If False, only top-level sessions (parent_id IS NULL) are returned.
        Defaults to True for backward compatibility.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        raise FileNotFoundError(f"database not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    try:
        filter_clause = "" if include_children else "WHERE parent_session_id IS NULL"
        cursor = conn.execute(
            f"""
            SELECT id, title, source, model, started_at, ended_at,
                   message_count, tool_call_count, parent_session_id
            FROM sessions
            {filter_clause}
            ORDER BY started_at
            """
        )
        rows = cursor.fetchall()
        session_ids = [row["id"] for row in rows]

        # Batch-load all messages for sessions in one query
        messages_by_session: dict[str, list[dict[str, Any]]] = {sid: [] for sid in session_ids}
        if session_ids:
            placeholders = ",".join("?" * len(session_ids))
            msg_cursor = conn.execute(
                f"""
                SELECT session_id, role, content, tool_calls, tool_call_id, timestamp
                FROM messages
                WHERE session_id IN ({placeholders})
                ORDER BY session_id, timestamp, id
                """,
                tuple(session_ids),
            )
            for msg_row in msg_cursor.fetchall():
                sid = msg_row["session_id"]
                msg: dict[str, Any] = {
                    "role": msg_row["role"],
                    "content": msg_row["content"],
                    "tool_call_id": msg_row["tool_call_id"],
                }
                if msg_row["tool_calls"]:
                    try:
                        msg["tool_calls"] = json.loads(msg_row["tool_calls"])
                    except json.JSONDecodeError:
                        msg["tool_calls"] = []
                messages_by_session[sid].append(msg)

        sessions: list[Session] = []
        for row in rows:
            session_id = row["id"]
            title = row["title"] or session_id
            messages = messages_by_session[session_id]

            tool_calls = _extract_tool_calls_from_messages(messages)
            memory_events = _infer_memory_events(tool_calls)
            search_hits = _infer_search_hits(tool_calls, session_id, messages)
            preview = _build_preview(messages)

            started_at = _datetime_from_timestamp(row["started_at"])
            ended_at = _datetime_from_timestamp(row["ended_at"])
            duration_sec = max(0.0, (ended_at - started_at).total_seconds())

            cron_job_id = _extract_cron_job_id(session_id)

            sessions.append(
                Session(
                    id=session_id,
                    title=title,
                    started_at=started_at,
                    duration_sec=duration_sec,
                    model=row["model"] or "unknown",
                    message_count=row["message_count"] or 0,
                    tool_calls=tuple(tool_calls),
                    memory_events=tuple(memory_events),
                    search_hits=tuple(search_hits),
                    preview=preview,
                    raw={"db_row": dict(row), "messages": messages},
                    parent_id=row["parent_session_id"],
                    cron_job_id=cron_job_id,
                )
            )

        return sessions
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Legacy JSON/JSONL parsing (kept for tests and fixture consumption)
# ---------------------------------------------------------------------------


def _parse_fixture_json(path: Path) -> Session:
    """Parse the hand-crafted fixture format (sess_*.json)."""
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


def _parse_session_json(path: Path) -> Session:
    """Parse Hermes session archive format (session_*.json, session_cron_*.json)."""
    data = json.loads(path.read_text())
    session_id = str(data.get("session_id", path.stem))
    model = data.get("model") or "unknown"
    messages = data.get("messages", [])

    started_at = (
        _parse_iso(data["session_start"]) if data.get("session_start") else datetime.now(UTC)
    )
    ended_at = _parse_iso(data["last_updated"]) if data.get("last_updated") else started_at
    duration_sec = max(0.0, (ended_at - started_at).total_seconds())

    tool_calls = _extract_tool_calls_from_messages(messages)
    memory_events = _infer_memory_events(tool_calls)
    search_hits = _infer_search_hits(tool_calls, session_id, messages)

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
    search_hits = _infer_search_hits(tool_calls, session_id, messages)

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


def _is_fixture_format(data: dict[str, Any]) -> bool:
    """Detect if JSON data matches the hand-crafted fixture schema."""
    return "id" in data and "started_at" in data and "tool_calls" in data


def _is_session_archive_format(data: dict[str, Any]) -> bool:
    """Detect if JSON data matches the Hermes session archive schema."""
    return "session_id" in data and "messages" in data


def parse_session(path: Path) -> Session:
    path = Path(path)
    if path.suffix == ".jsonl":
        return _parse_jsonl(path)

    data = json.loads(path.read_text())
    if _is_fixture_format(data):
        return _parse_fixture_json(path)
    if _is_session_archive_format(data):
        return _parse_session_json(path)

    raise ValueError(f"unrecognized JSON format in {path}")
