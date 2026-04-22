from datetime import UTC, datetime

from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.ingest import Session, ToolCall


def _tc(name: str, args: str) -> ToolCall:
    return ToolCall(name=name, raw={"function": {"name": name, "arguments": args}})


def _sess(id: str, tool_calls: list[ToolCall]) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, tzinfo=UTC),
        duration_sec=60,
        model="t",
        message_count=1,
        tool_calls=tuple(tool_calls),
        memory_events=(),
        search_hits=(),
    )


def test_skill_manage_view_link() -> None:
    a = _sess("A", [_tc("skill_manage", '{"name":"blade"}')])
    b = _sess("B", [_tc("skill_view", '{"name":"blade"}')])

    edges = detect_tool_overlap([a, b])

    assert len(edges) == 1
    assert edges[0].kind == "tool-overlap"
    assert edges[0].evidence["skill_name"] == "blade"


def test_skill_view_view_no_link() -> None:
    """Two sessions that only VIEW a skill should not be linked."""
    a = _sess("A", [_tc("skill_view", '{"name":"blade"}')])
    b = _sess("B", [_tc("skill_view", '{"name":"blade"}')])

    edges = detect_tool_overlap([a, b])

    assert edges == []


def test_skill_manage_manage_link() -> None:
    a = _sess("A", [_tc("skill_manage", '{"name":"blade"}')])
    b = _sess("B", [_tc("skill_manage", '{"name":"blade"}')])

    edges = detect_tool_overlap([a, b])

    assert len(edges) == 1
    assert edges[0].evidence["skill_name"] == "blade"


def test_web_search_same_query_link() -> None:
    a = _sess("A", [_tc("web_search", '{"query":"rlstm cpu"}')])
    b = _sess("B", [_tc("web_search", '{"query":"rlstm cpu"}')])

    edges = detect_tool_overlap([a, b])

    assert len(edges) == 1
    assert "rlstm cpu" in edges[0].evidence["web_key"]


def test_web_extract_same_url_link() -> None:
    a = _sess("A", [_tc("web_extract", '{"urls":["https://example.com/a"]}')])
    b = _sess("B", [_tc("web_extract", '{"urls":["https://example.com/a"]}')])

    edges = detect_tool_overlap([a, b])

    assert len(edges) == 1
    assert "https://example.com/a" in edges[0].evidence["web_key"]


def test_different_skills_no_link() -> None:
    a = _sess("A", [_tc("skill_manage", '{"name":"blade"}')])
    b = _sess("B", [_tc("skill_manage", '{"name":"nanochat"}')])

    edges = detect_tool_overlap([a, b])

    assert edges == []


def test_generic_tools_ignored() -> None:
    a = _sess("A", [_tc("terminal", "{}"), _tc("read_file", "{}")])
    b = _sess("B", [_tc("terminal", "{}"), _tc("read_file", "{}")])

    edges = detect_tool_overlap([a, b])

    assert edges == []
