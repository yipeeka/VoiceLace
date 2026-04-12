from __future__ import annotations

from backend.engine.mixer_engine import TimelineEntry


def _fmt_srt_ms(ms: int) -> str:
    ms = max(0, int(ms))
    hh = ms // 3600000
    mm = (ms % 3600000) // 60000
    ss = (ms % 60000) // 1000
    mmm = ms % 1000
    return f"{hh:02}:{mm:02}:{ss:02},{mmm:03}"


def _fmt_lrc_ms(ms: int) -> str:
    ms = max(0, int(ms))
    mm = ms // 60000
    ss = (ms % 60000) // 1000
    cs = (ms % 1000) // 10
    return f"{mm:02}:{ss:02}.{cs:02}"


def timeline_to_srt(entries: list[TimelineEntry]) -> str:
    lines: list[str] = []
    for idx, entry in enumerate(entries, start=1):
        text = f"{entry.speaker}: {entry.text}".strip()
        lines.append(str(idx))
        lines.append(f"{_fmt_srt_ms(entry.start_ms)} --> {_fmt_srt_ms(entry.end_ms)}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def timeline_to_lrc(entries: list[TimelineEntry]) -> str:
    lines: list[str] = []
    for entry in entries:
        text = f"{entry.speaker}: {entry.text}".strip()
        lines.append(f"[{_fmt_lrc_ms(entry.start_ms)}]{text}")
    return "\n".join(lines).strip() + "\n"
