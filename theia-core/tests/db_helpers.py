import json
import sqlite3
from datetime import datetime
from pathlib import Path


def seed_test_db(db_path: Path, fixture_dir: Path) -> None:
    """Create a temporary SQLite DB seeded with hand-crafted fixture JSONs."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'cli',
            model TEXT,
            started_at REAL NOT NULL,
            ended_at REAL,
            message_count INTEGER DEFAULT 0,
            tool_call_count INTEGER DEFAULT 0,
            parent_session_id TEXT,
            title TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_calls TEXT,
            tool_call_id TEXT,
            timestamp REAL NOT NULL
        );
        """
    )

    for p in sorted(fixture_dir.glob("*.json")):
        data = json.loads(p.read_text())
        session_id = data["id"]
        started = datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
        started_at = started.timestamp()
        ended_at = started_at + data.get("duration_sec", 0)
        title = data.get("title", "")

        conn.execute(
            """
            INSERT INTO sessions (id, source, model, started_at, ended_at, message_count, title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                "cli",
                data.get("model", "unknown"),
                started_at,
                ended_at,
                data.get("message_count", 0),
                title,
            ),
        )

        # Tool calls as assistant messages
        for tc in data.get("tool_calls", []):
            conn.execute(
                """
                INSERT INTO messages (session_id, role, tool_calls, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                (
                    session_id,
                    "assistant",
                    json.dumps([{"id": "tc", "type": "function", "function": tc}]),
                    started_at + 1,
                ),
            )

        # Memory events
        for me in data.get("memory_events", []):
            conn.execute(
                """
                INSERT INTO messages (session_id, role, tool_calls, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                (
                    session_id,
                    "assistant",
                    json.dumps(
                        [
                            {
                                "id": "tc",
                                "type": "function",
                                "function": {
                                    "name": "memory",
                                    "arguments": json.dumps(
                                        {"action": me["kind"], "memory_id": me["memory_id"]}
                                    ),
                                },
                            }
                        ]
                    ),
                    started_at + 2,
                ),
            )

        # Search hits
        for sh in data.get("search_hits", []):
            conn.execute(
                """
                INSERT INTO messages (session_id, role, tool_calls, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                (
                    session_id,
                    "assistant",
                    json.dumps(
                        [
                            {
                                "id": "tc",
                                "type": "function",
                                "function": {
                                    "name": "session_search",
                                    "arguments": json.dumps(
                                        {
                                            "query": sh["query"],
                                            "source_session_id": sh["source_session_id"],
                                        }
                                    ),
                                },
                            }
                        ]
                    ),
                    started_at + 3,
                ),
            )

    conn.commit()
    conn.close()
