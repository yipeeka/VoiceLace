from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class TimelineEntry:
    segment_id: str
    speaker: str
    text: str
    start_ms: int
    end_ms: int
    duration_ms: int


class MixerEngine:
    def mix_segments(
        self,
        segment_inputs: list[dict],
        gap_ms: int = 500,
        crossfade_ms: int = 30,
        normalize: bool = True,
        target_sample_rate: int = 24000,
    ):
        try:
            from pydub import AudioSegment
            from pydub.effects import normalize as normalize_audio
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"MixerEngine requires pydub: {exc}") from exc

        merged = AudioSegment.silent(duration=0, frame_rate=target_sample_rate).set_channels(1)
        timeline: list[TimelineEntry] = []
        cursor_ms = 0

        for index, item in enumerate(segment_inputs):
            path = Path(item["path"])
            audio = AudioSegment.from_file(str(path))
            audio = audio.set_frame_rate(target_sample_rate).set_channels(1)
            if normalize:
                audio = normalize_audio(audio)
            if crossfade_ms > 0:
                fade_ms = min(crossfade_ms, max(1, len(audio) // 8))
                audio = audio.fade_in(fade_ms).fade_out(fade_ms)

            start_ms = cursor_ms
            end_ms = start_ms + len(audio)
            timeline.append(
                TimelineEntry(
                    segment_id=str(item["segment_id"]),
                    speaker=str(item.get("speaker", "narrator")),
                    text=str(item.get("text", "")),
                    start_ms=start_ms,
                    end_ms=end_ms,
                    duration_ms=len(audio),
                )
            )
            merged += audio
            cursor_ms = end_ms

            if index < len(segment_inputs) - 1 and gap_ms > 0:
                merged += AudioSegment.silent(duration=gap_ms, frame_rate=target_sample_rate).set_channels(1)
                cursor_ms += gap_ms

        return merged, timeline
