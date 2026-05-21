#!/usr/bin/env python3
r"""
Repair CrispASR SRT timing with JSON full character timestamps.

Typical usage:

  python repair_srt_from_crispasr_json.py ^
    --srt samples\Germanypoor_qwen3_vad_split_full.srt ^
    --json samples\Germanypoor_qwen3_vad_split_full.json ^
    --audio samples\Germanypoor.MP3 ^
    --out samples\Germanypoor_qwen3_vad_split_full_json_repaired.srt

The script prefers transcription[].words[].t0/t1 from CrispASR JSON full.
Those values are centiseconds in the current Qwen3 aligner output, so they are
converted to milliseconds by multiplying by 10.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


PUNCT_ONLY_RE = re.compile(r"^[\s，。！？；：、“”‘’\"'（）()\[\]《》…—-]+$")


@dataclass
class Entry:
    start: int
    end: int
    text: str
    degenerate_json_span: bool = False


@dataclass
class Word:
    text: str
    start: int
    end: int


def parse_timestamp(value: str) -> int:
    hours, minutes, rest = value.split(":")
    seconds, millis = rest.split(",")
    return (
        (int(hours) * 3600 + int(minutes) * 60 + int(seconds)) * 1000
        + int(millis)
    )


def format_timestamp(ms: int) -> str:
    ms = max(0, int(round(ms)))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value)


def parse_srt(path: Path) -> list[Entry]:
    text = read_text_lossy(path)
    blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    entries: list[Entry] = []

    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        match = re.match(r"(.+?)\s+-->\s+(.+)", lines[1])
        if not match:
            continue
        entries.append(
            Entry(
                start=parse_timestamp(match.group(1)),
                end=parse_timestamp(match.group(2)),
                text="\n".join(lines[2:]).strip(),
            )
        )
    return entries


def load_json_words(path: Path) -> list[Word]:
    data = json.loads(read_text_lossy(path))
    words: list[Word] = []

    for segment in data.get("transcription", []):
        for item in segment.get("words", []):
            t0 = item.get("t0", -1)
            t1 = item.get("t1", -1)
            if t0 >= 0 and t1 >= 0:
                words.append(Word(text=item["text"], start=t0 * 10, end=t1 * 10))
    return words


def read_text_lossy(path: Path) -> str:
    """Read UTF-8 text, replacing malformed bytes from imperfect tool output."""
    return path.read_bytes().decode("utf-8-sig", errors="replace")


def get_audio_duration_ms(path: Path | None) -> int | None:
    if path is None:
        return None

    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    return int(float(completed.stdout.strip()) * 1000)


def find_word_span(
    words: list[Word], full_text: str, subtitle_text: str, search_from: int
) -> tuple[int, int, int] | None:
    needle = normalize_text(subtitle_text)
    found = full_text.find(needle, search_from)
    if found < 0:
        return None

    cursor = 0
    first_index: int | None = None
    last_index: int | None = None
    target_end = found + len(needle)

    for index, word in enumerate(words):
        next_cursor = cursor + len(word.text)
        if first_index is None and next_cursor > found:
            first_index = index
        if cursor < target_end:
            last_index = index
        cursor = next_cursor
        if cursor >= target_end:
            break

    if first_index is None or last_index is None:
        return None
    return first_index, last_index, target_end


def apply_json_word_times(entries: list[Entry], words: list[Word]) -> tuple[list[Entry], int, list[int]]:
    full_text = "".join(word.text for word in words)
    search_from = 0
    matched = 0
    unmatched: list[int] = []
    repaired: list[Entry] = []

    for number, entry in enumerate(entries, 1):
        start = entry.start
        end = entry.end
        degenerate = False
        span_indexes = find_word_span(words, full_text, entry.text, search_from)

        if span_indexes is None:
            unmatched.append(number)
        else:
            first_index, last_index, search_from = span_indexes
            span = words[first_index : last_index + 1]
            json_start = min(word.start for word in span)
            json_end = max(word.end for word in span)
            start = json_start
            end = json_end
            degenerate = json_end <= json_start
            matched += 1

        repaired.append(
            Entry(
                start=start,
                end=end,
                text=entry.text,
                degenerate_json_span=degenerate,
            )
        )

    return repaired, matched, unmatched


def finalize_entries(
    original: list[Entry],
    entries: list[Entry],
    audio_duration_ms: int | None,
) -> tuple[list[Entry], list[str]]:
    final: list[Entry] = []
    changes: list[str] = []

    for index, entry in enumerate(entries):
        number = index + 1
        start = entry.start
        end = entry.end
        text = entry.text
        original_entry = original[index]

        if audio_duration_ms is not None and end > audio_duration_ms:
            changes.append(
                f"#{number}: end clamped {format_timestamp(end)} -> "
                f"{format_timestamp(audio_duration_ms)} to stay within audio"
            )
            end = audio_duration_ms

        if end <= start:
            near_audio_end = (
                audio_duration_ms is not None and audio_duration_ms - start <= 500
            )
            should_merge = (
                bool(final)
                and (
                    PUNCT_ONLY_RE.match(text)
                    or len(normalize_text(text)) <= 12
                    or near_audio_end
                    or entry.degenerate_json_span
                )
            )

            if should_merge:
                final[-1].text = final[-1].text.rstrip() + text
                changes.append(
                    f"#{number}: merged degenerate/zero-duration text into previous: {text}"
                )
                continue

            end = start + 300
            if audio_duration_ms is not None:
                end = min(end, audio_duration_ms)
            if end <= start and final:
                final[-1].text = final[-1].text.rstrip() + text
                changes.append(
                    f"#{number}: merged zero-duration text into previous after audio clamp: {text}"
                )
                continue
            changes.append(
                f"#{number}: extended zero-duration text to {format_timestamp(end)}: {text}"
            )

        if final and start < final[-1].end:
            changes.append(
                f"#{number}: start shifted {format_timestamp(start)} -> "
                f"{format_timestamp(final[-1].end)} to remove overlap"
            )
            start = final[-1].end
            if end <= start:
                if len(normalize_text(text)) <= 12:
                    final[-1].text = final[-1].text.rstrip() + text
                    changes.append(
                        f"#{number}: merged into previous because overlap left no duration: {text}"
                    )
                    continue
                end = start + 300
                if audio_duration_ms is not None:
                    end = min(end, audio_duration_ms)

        if start != original_entry.start or end != original_entry.end:
            changes.append(
                f"#{number}: {format_timestamp(original_entry.start)}-"
                f"{format_timestamp(original_entry.end)} -> "
                f"{format_timestamp(start)}-{format_timestamp(end)}"
            )

        final.append(Entry(start=start, end=end, text=text))

    return final, changes


def count_zero_or_negative(entries: list[Entry]) -> int:
    return sum(1 for entry in entries if entry.end <= entry.start)


def count_overlaps(entries: list[Entry]) -> int:
    return sum(
        1 for previous, current in zip(entries, entries[1:]) if current.start < previous.end
    )


def count_out_of_audio(entries: list[Entry], audio_duration_ms: int | None) -> int:
    if audio_duration_ms is None:
        return 0
    return sum(
        1 for entry in entries if entry.start < 0 or entry.end > audio_duration_ms
    )


def write_srt(path: Path, entries: list[Entry]) -> None:
    parts = []
    for number, entry in enumerate(entries, 1):
        parts.append(
            f"{number}\n"
            f"{format_timestamp(entry.start)} --> {format_timestamp(entry.end)}\n"
            f"{entry.text}"
        )
    path.write_text("\n\n".join(parts) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repair CrispASR SRT using JSON full words timestamps."
    )
    parser.add_argument("--srt", required=True, type=Path, help="Input SRT file")
    parser.add_argument("--json", required=True, type=Path, help="CrispASR JSON full file")
    parser.add_argument("--audio", type=Path, help="Optional audio file for duration clamp")
    parser.add_argument("--out", required=True, type=Path, help="Output repaired SRT file")
    parser.add_argument(
        "--report",
        type=Path,
        help="Optional repair report path. Defaults to <out>.report.txt",
    )
    args = parser.parse_args()

    report_path = args.report or args.out.with_suffix(args.out.suffix + ".report.txt")
    original_entries = parse_srt(args.srt)
    words = load_json_words(args.json)
    audio_duration_ms = get_audio_duration_ms(args.audio)

    if not original_entries:
        raise SystemExit(f"No SRT entries found: {args.srt}")
    if not words:
        raise SystemExit(
            f"No JSON full words timestamps found: {args.json}. "
            "Make sure the JSON was generated with -ojf and a timestamp-capable backend."
        )

    json_timed_entries, matched, unmatched = apply_json_word_times(
        original_entries, words
    )
    final_entries, changes = finalize_entries(
        original_entries, json_timed_entries, audio_duration_ms
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    write_srt(args.out, final_entries)

    report_lines = [
        f"source_srt={args.srt}",
        f"source_json={args.json}",
        f"audio={args.audio}" if args.audio else "audio=",
        f"audio_duration_ms={audio_duration_ms}" if audio_duration_ms else "audio_duration_ms=",
        f"output_srt={args.out}",
        f"entries_before={len(original_entries)}",
        f"entries_after={len(final_entries)}",
        f"json_words={len(words)}",
        f"entries_matched_to_json_words={matched}",
        f"unmatched_entries={unmatched}",
        f"zero_or_negative_before={count_zero_or_negative(original_entries)}",
        f"zero_or_negative_after={count_zero_or_negative(final_entries)}",
        f"overlap_before={count_overlaps(original_entries)}",
        f"overlap_after={count_overlaps(final_entries)}",
        f"out_of_audio_after={count_out_of_audio(final_entries, audio_duration_ms)}",
        "",
        "changes:",
        *changes,
    ]
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    print("\n".join(report_lines[:15]))
    print(f"report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
