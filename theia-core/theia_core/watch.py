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
