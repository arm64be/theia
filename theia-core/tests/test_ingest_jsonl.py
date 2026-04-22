from datetime import UTC, datetime
from pathlib import Path

from theia_core.ingest import parse_session

HERMES_JSONL = (
    '{"role":"system","tools":[{"type":"function","function":'
    '{"name":"terminal"}}],"model":"claude-3-opus","platform":"cli",'
    '"timestamp":"2026-04-16T20:53:35.860369"}\n'
    '{"role":"user","content":"hello",'
    '"timestamp":"2026-04-16T20:53:35.860369"}\n'
    '{"role":"assistant","content":"hi","tool_calls":['
    '{"id":"tc1","type":"function","function":'
    '{"name":"terminal","arguments":"{\\"cmd\\": \\"ls\\"}"}}],'
    '"timestamp":"2026-04-16T20:53:36.860369"}\n'
    '{"role":"tool","content":"file.txt","tool_call_id":"tc1",'
    '"timestamp":"2026-04-16T20:53:37.860369"}\n'
)


def test_parse_jsonl_hermes_format(tmp_path: Path) -> None:
    p = tmp_path / "20260416_205335_072c72.jsonl"
    p.write_text(HERMES_JSONL)

    sess = parse_session(p)

    assert sess.id == "20260416_205335_072c72"
    assert sess.model == "claude-3-opus"
    assert sess.message_count == 3
    assert len(sess.tool_calls) == 1
    assert sess.tool_calls[0].name == "terminal"
    assert sess.duration_sec > 0
    assert sess.started_at == datetime(2026, 4, 16, 20, 53, 35, 860369, tzinfo=UTC)


def test_parse_jsonl_memory_tool(tmp_path: Path) -> None:
    text = (
        '{"role":"system","tools":[],"model":"test","platform":"cli",'
        '"timestamp":"2026-04-16T20:53:35.860369"}\n'
        '{"role":"user","content":"remember this",'
        '"timestamp":"2026-04-16T20:53:35.860369"}\n'
        '{"role":"assistant","content":"ok","tool_calls":['
        '{"id":"tc1","type":"function","function":'
        '{"name":"memory","arguments":'
        '"{\\"action\\": \\"write\\", \\"memory_id\\": \\"mem_1\\"}"}}],'
        '"timestamp":"2026-04-16T20:53:36.860369"}\n'
    )
    p = tmp_path / "sess.jsonl"
    p.write_text(text)

    sess = parse_session(p)

    assert len(sess.memory_events) == 1
    assert sess.memory_events[0].kind == "write"
    assert sess.memory_events[0].memory_id == "mem_1"


def test_parse_jsonl_session_search(tmp_path: Path) -> None:
    text = (
        '{"role":"system","tools":[],"model":"test","platform":"cli",'
        '"timestamp":"2026-04-16T20:53:35.860369"}\n'
        '{"role":"user","content":"search",'
        '"timestamp":"2026-04-16T20:53:35.860369"}\n'
        '{"role":"assistant","content":"ok","tool_calls":['
        '{"id":"tc1","type":"function","function":'
        '{"name":"session_search","arguments":'
        '"{\\"query\\": \\"auth\\", \\"source_session_id\\": \\"other\\"}"}}],'
        '"timestamp":"2026-04-16T20:53:36.860369"}\n'
    )
    p = tmp_path / "sess.jsonl"
    p.write_text(text)

    sess = parse_session(p)

    assert len(sess.search_hits) == 1
    assert sess.search_hits[0].query == "auth"
    assert sess.search_hits[0].source_session_id == "other"
