import threading
import time
from pathlib import Path

from theia_core.watch import _snapshot, watch_db


def test_snapshot_detects_mtime_change(tmp_path: Path) -> None:
    f = tmp_path / "state.db"
    f.write_text("{}")
    snap1 = _snapshot([f])
    assert snap1[f] is not None
    time.sleep(0.05)
    f.write_text('{"x":1}')
    snap2 = _snapshot([f])
    assert snap2[f] != snap1[f]


def test_watch_db_triggers_on_change(tmp_path: Path) -> None:
    calls: list[int] = []
    stop = threading.Event()

    def callback() -> None:
        calls.append(len(calls) + 1)
        stop.set()

    def should_stop() -> bool:
        return stop.is_set()

    db = tmp_path / "state.db"
    db.write_text("{}")

    t = threading.Thread(
        target=watch_db,
        args=(db, callback),
        kwargs={"interval": 0.05, "debounce": 0.05, "should_stop": should_stop},
    )
    t.start()

    # Give watcher time to take initial snapshot
    time.sleep(0.1)
    db.write_text('{"updated":1}')

    t.join(timeout=2)
    assert calls == [1]
