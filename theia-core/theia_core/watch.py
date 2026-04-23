from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path


def _snapshot(paths: list[Path]) -> dict[Path, float | None]:
    """Return mtime for each path; None if the path does not exist."""
    snap: dict[Path, float | None] = {}
    for p in paths:
        try:
            snap[p] = p.stat().st_mtime
        except OSError:
            snap[p] = None
    return snap


def _collect_session_paths(directory: Path) -> list[Path]:
    directory = Path(directory)
    patterns = ["session_*.json", "session_cron_*.json", "*.jsonl", "*.json"]
    paths: set[Path] = set()
    for pat in patterns:
        paths.update(directory.glob(pat))
    return sorted(p for p in paths if not p.name.startswith("request_dump_"))


def watch_sessions(
    sessions_dir: Path,
    callback: Callable[[], None],
    interval: float = 1.0,
    debounce: float = 0.5,
    should_stop: Callable[[], bool] | None = None,
) -> None:
    """Poll *sessions_dir* for new/changed/deleted session files and call *callback*.

    The callback is invoked at most once per *debounce* seconds after the last
    detected change. If *should_stop* returns True the loop exits.
    """
    sessions_dir = Path(sessions_dir)
    last_snap = _snapshot(_collect_session_paths(sessions_dir))
    pending = False
    last_change_at = 0.0

    print(f"watching {sessions_dir} for session changes (interval={interval}s)")
    while True:
        time.sleep(interval)
        if should_stop is not None and should_stop():
            break
        current_paths = _collect_session_paths(sessions_dir)
        current_snap = _snapshot(current_paths)

        changed = False
        all_paths = set(last_snap.keys()) | set(current_snap.keys())
        for p in all_paths:
            if last_snap.get(p) != current_snap.get(p):
                changed = True
                break

        if changed:
            last_snap = current_snap
            last_change_at = time.monotonic()
            pending = True

        if pending and (time.monotonic() - last_change_at) >= debounce:
            pending = False
            callback()


def watch_db(
    db_path: Path,
    callback: Callable[[], None],
    interval: float = 1.0,
    debounce: float = 0.5,
    should_stop: Callable[[], bool] | None = None,
) -> None:
    """Poll *db_path* for modifications and call *callback*.

    The callback is invoked at most once per *debounce* seconds after the last
    detected change. If *should_stop* returns True the loop exits.
    """
    db_path = Path(db_path)
    last_snap = _snapshot([db_path])
    pending = False
    last_change_at = 0.0

    print(f"watching {db_path} for changes (interval={interval}s)")
    while True:
        time.sleep(interval)
        if should_stop is not None and should_stop():
            break
        current_snap = _snapshot([db_path])

        if last_snap.get(db_path) != current_snap.get(db_path):
            last_snap = current_snap
            last_change_at = time.monotonic()
            pending = True

        if pending and (time.monotonic() - last_change_at) >= debounce:
            pending = False
            callback()
