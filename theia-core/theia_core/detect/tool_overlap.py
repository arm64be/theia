from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from theia_core.detect import Edge
from theia_core.ingest import Session


def _extract_skill_name(tc: dict[str, Any]) -> str | None:
    fn = tc.get("function") or {}
    args_str = fn.get("arguments", "{}")
    try:
        args = json.loads(args_str) if isinstance(args_str, str) else args_str
    except json.JSONDecodeError:
        return None
    return str(args.get("name", "")) or None


def _extract_web_keys(tc: dict[str, Any]) -> list[str]:
    """Return URL keys for web_search (query) and web_extract (urls)."""
    fn = tc.get("function") or {}
    name = fn.get("name", "")
    args_str = fn.get("arguments", "{}")
    try:
        args = json.loads(args_str) if isinstance(args_str, str) else args_str
    except json.JSONDecodeError:
        return []
    keys: list[str] = []
    if name == "web_search":
        query = str(args.get("query", ""))
        if query:
            keys.append(f"search:{query}")
    elif name == "web_extract":
        urls = args.get("urls", [])
        if isinstance(urls, str):
            urls = [urls]
        for url in urls:
            url_str = str(url).strip()
            if url_str:
                keys.append(f"url:{url_str}")
    return keys


def detect_tool_overlap(sessions: Iterable[Session]) -> list[Edge]:
    sessions = sorted(sessions, key=lambda s: s.started_at)

    # Skill name -> last (session_id, managed?) that touched it
    skill_last: dict[str, tuple[str, bool]] = {}

    # Web key -> last session_id that touched it
    web_last: dict[str, str] = {}

    edges: list[Edge] = []

    for sess in sessions:
        for tc in sess.tool_calls:
            if tc.name == "skill_view":
                name = _extract_skill_name(tc.raw)
                if name is None:
                    continue
                if name in skill_last:
                    last_id, last_managed = skill_last[name]
                    # Only link if the prior session managed the skill
                    if last_managed:
                        edges.append(
                            Edge(
                                source=last_id,
                                target=sess.id,
                                kind="tool-overlap",
                                weight=1.0,
                                evidence={"skill_name": name, "link_type": "view_after"},
                            )
                        )
                skill_last[name] = (sess.id, False)

            elif tc.name == "skill_manage":
                name = _extract_skill_name(tc.raw)
                if name is None:
                    continue
                if name in skill_last:
                    last_id, _last_managed = skill_last[name]
                    edges.append(
                        Edge(
                            source=last_id,
                            target=sess.id,
                            kind="tool-overlap",
                            weight=1.0,
                            evidence={"skill_name": name, "link_type": "manage_after"},
                        )
                    )
                skill_last[name] = (sess.id, True)

            elif tc.name in ("web_search", "web_extract"):
                for key in _extract_web_keys(tc.raw):
                    if key in web_last:
                        edges.append(
                            Edge(
                                source=web_last[key],
                                target=sess.id,
                                kind="tool-overlap",
                                weight=1.0,
                                evidence={"web_key": key},
                            )
                        )
                    web_last[key] = sess.id

    return edges
