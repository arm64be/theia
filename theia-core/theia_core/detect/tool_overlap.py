from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Iterable
from itertools import combinations

from theia_core.detect import Edge
from theia_core.ingest import Session


def _extract_skill_name(tc: dict[str, object]) -> str | None:
    fn = tc.get("function", {})
    args_str = fn.get("arguments", "{}")
    try:
        args = json.loads(args_str) if isinstance(args_str, str) else args_str
    except json.JSONDecodeError:
        return None
    return str(args.get("name", "")) or None


def _extract_web_keys(tc: dict[str, object]) -> list[str]:
    """Return URL keys for web_search (query) and web_extract (urls)."""
    fn = tc.get("function", {})
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
    sessions = list(sessions)

    # Skill name -> {session_ids that viewed it}, {session_ids that managed it}
    skill_views: dict[str, set[str]] = defaultdict(set)
    skill_manages: dict[str, set[str]] = defaultdict(set)

    # Web key -> session_ids
    web_sessions: dict[str, set[str]] = defaultdict(set)

    for sess in sessions:
        for tc in sess.tool_calls:
            if tc.name == "skill_view":
                name = _extract_skill_name(tc.raw)
                if name:
                    skill_views[name].add(sess.id)
            elif tc.name == "skill_manage":
                name = _extract_skill_name(tc.raw)
                if name:
                    skill_manages[name].add(sess.id)
            elif tc.name in ("web_search", "web_extract"):
                for key in _extract_web_keys(tc.raw):
                    web_sessions[key].add(sess.id)

    edges: list[Edge] = []

    # Skill edges: same skill, at least one session managed it
    for skill_name, managed_by in skill_manages.items():
        viewed_by = skill_views.get(skill_name, set())
        # All sessions involved with this skill
        all_involved = managed_by | viewed_by
        if len(all_involved) < 2:
            continue
        # Only pairs where at least one session managed it
        # (i.e., exclude pairs where both only viewed)
        for a, b in combinations(sorted(all_involved), 2):
            if a in managed_by or b in managed_by:
                edges.append(
                    Edge(
                        source=a,
                        target=b,
                        kind="tool-overlap",
                        weight=1.0,
                        evidence={
                            "skill_name": skill_name,
                            "managed": sorted(managed_by & {a, b}),
                            "viewed": sorted(viewed_by & {a, b}),
                        },
                    )
                )

    # Web edges: same query or same URL
    for key, sess_ids in web_sessions.items():
        if len(sess_ids) < 2:
            continue
        for a, b in combinations(sorted(sess_ids), 2):
            edges.append(
                Edge(
                    source=a,
                    target=b,
                    kind="tool-overlap",
                    weight=1.0,
                    evidence={"web_key": key},
                )
            )

    return edges
