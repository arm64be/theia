from datetime import datetime, timezone
from pathlib import Path

import pytest

from theia_core.ingest import parse_session, Session


FIXTURE_JSON = """
{
  "id": "sess_aaa",
  "title": "Refactor auth",
  "started_at": "2026-04-18T09:14:00Z",
  "duration_sec": 3421,
  "model": "claude-opus-4-7",
  "message_count": 187,
  "tool_calls": [{"name": "bash"}, {"name": "read"}],
  "memory_events": [
    {"kind": "write", "memory_id": "mem_1", "salience": 0.8},
    {"kind": "read", "memory_id": "mem_9"}
  ],
  "search_hits": [
    {"query": "auth middleware", "source_session_id": "sess_bbb", "hit_rank": 1}
  ]
}
"""


def test_parse_session_happy_path(tmp_path: Path) -> None:
    p = tmp_path / "sess.json"
    p.write_text(FIXTURE_JSON)

    sess = parse_session(p)

    assert isinstance(sess, Session)
    assert sess.id == "sess_aaa"
    assert sess.title == "Refactor auth"
    assert sess.started_at == datetime(2026, 4, 18, 9, 14, tzinfo=timezone.utc)
    assert sess.duration_sec == pytest.approx(3421)
    assert len(sess.tool_calls) == 2
    assert sess.tool_calls[0].name == "bash"
    assert len(sess.memory_events) == 2
    assert sess.memory_events[0].kind == "write"
    assert sess.memory_events[0].memory_id == "mem_1"
    assert sess.memory_events[0].salience == pytest.approx(0.8)
    assert len(sess.search_hits) == 1


def test_load_sessions_reads_all(tmp_path: Path) -> None:
    from theia_core.ingest import load_sessions

    (tmp_path / "a.json").write_text(FIXTURE_JSON)
    (tmp_path / "b.json").write_text(FIXTURE_JSON.replace("sess_aaa", "sess_bbb"))
    (tmp_path / "ignore.txt").write_text("not a session")

    sessions = load_sessions(tmp_path)

    assert {s.id for s in sessions} == {"sess_aaa", "sess_bbb"}
