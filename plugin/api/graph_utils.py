"""Theia Constellation — shared utility functions."""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from functools import lru_cache


def iso_now() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()


def timestamp_to_iso(ts: float | None) -> str:
    """Convert a UNIX timestamp to ISO 8601, or return epoch if None."""
    if ts is None:
        return "1970-01-01T00:00:00+00:00"
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()


def compute_duration(started: float | None, ended: float | None) -> float:
    """Return session duration in seconds, or 0.0 if timestamps are missing."""
    if started and ended:
        return max(0.0, float(ended) - float(started))
    return 0.0


@lru_cache(maxsize=1024)
def hash_to_float(s: str) -> float:
    """Deterministic string -> [0, 1) float via FNV-style hash.

    Uses the first 8 hex digits of a SHA-256 hash (faster than MD5 on
    modern CPUs with hardware SHA support). Results are cached to avoid
    re-hashing the same model/date strings across requests.
    """
    h = int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
    return (h % 10000) / 10000.0


# Pre-computed golden angle for jitter (avoids repeated multiplication)
_GOLDEN_ANGLE = 2.399


def jitter_pair(index: int, amplitude: float = 0.05) -> tuple[float, float]:
    """Return (jitter_x, jitter_y) based on golden-angle spacing."""
    angle = index * _GOLDEN_ANGLE
    return (math.sin(angle) * amplitude, math.cos(angle) * amplitude)
