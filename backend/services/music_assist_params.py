from __future__ import annotations

import math
from typing import Any


def nearest_allowed_int(value: Any, allowed_values: set[int]) -> int | None:
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    candidates = sorted(int(item) for item in allowed_values)
    if not candidates:
        return None
    return min(candidates, key=lambda item: (abs(item - numeric), item))


def coerce_allowed_string(value: Any, allowed_values: set[str]) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw in allowed_values:
        return raw
    lookup = {item.lower(): item for item in allowed_values}
    return lookup.get(raw.lower())
