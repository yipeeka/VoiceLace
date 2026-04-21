from __future__ import annotations

import json
import re
import time
from collections import Counter
from typing import Any, Awaitable, Callable
from uuid import uuid4

from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.models import Character, Script, Segment, StructuredCharacterDraft, StructuredScriptDraft, StructuredSegmentDraft

ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]
StageCallback = Callable[[str, str, int], Awaitable[None]]
ResolveChunkChars = Callable[[dict[str, Any]], int]
ParseStep1RawWithStats = Callable[
    ...,
    Awaitable[tuple[str, dict[str, Any]]],
]
ParseSingleWithProfile = Callable[
    ...,
    Awaitable[tuple[Script, dict[str, Any]]],
]

_PREF_LINE_SPEAKER_RE = re.compile(r"^(?P<speaker>[^：:\s][^：:]{0,80})[：:](?P<text>.+)$")
_NON_VERBAL_RE = re.compile(r"\[([^\[\]]+)\]")
_PINYIN_ANNOTATION_RE = re.compile(r"([\u4e00-\u9fff])([A-Z]{1,12}[1-5])")
_TTS_OVERRIDE_ALLOWED_KEYS = {"speed", "duration", "denoise", "num_step", "guidance_scale"}
_ALLOWED_NON_VERBAL_BARE = {
    "laughter",
    "sigh",
    "whisper",
    "dissatisfaction-hnn",
    "confirmation-en",
    "question-en",
    "question-ah",
    "question-oh",
    "question-ei",
    "question-yi",
    "surprise-ah",
    "surprise-oh",
    "surprise-wa",
    "surprise-yo",
}
_DIALOGUE_LEADIN_RE = re.compile(
    r"(道|问道|叹道|笑道|说道|喊道|叫道|应道|答道|劝道|哽咽道|低声问道|高声喊道|忙道|哭道)\s*[：:]$"
)
_SPEECH_LEADIN_SUFFIXES = [
    "低声问道",
    "高声喊道",
    "哽咽道",
    "迎出来道",
    "出来道",
    "忙道",
    "劝道",
    "问道",
    "叹道",
    "笑道",
    "说道",
    "喊道",
    "叫道",
    "哭道",
    "应道",
    "答道",
    "道",
]
_ACTION_TRAILING_WORDS = [
    "低声",
    "高声",
    "轻声",
    "哽咽",
    "惊呼",
    "吆喝",
    "笑着",
    "叹着",
    "笑",
    "叹",
    "劝",
    "问",
    "说",
    "喊",
    "叫",
    "哭",
    "忙",
]
_LEADING_SPEAKER_CUT_RE = re.compile(
    r"^([\u4e00-\u9fffA-Za-z0-9·]{1,12})(?:朝|向|对|把|将|便|就|又|还|先|忙|赶|回头|抬头|皱眉|点头|看|听|问|说|喊|叫)"
)
_INLINE_QUOTE_ATTR_RE = re.compile(r'^\s*[“"](?P<quote>[^”"]+)[”"]\s*(?P<attr>[^“”"]+?)\s*$')
_LEADING_QUOTE_WITH_CONTEXT_RE = re.compile(r'^\s*[“"](?P<quote>[^”"]+)[”"]\s*[，,]\s*(?P<rest>.+)$')
_ATTR_SPEAKER_RE = re.compile(
    r"^(?P<speaker>[\u4e00-\u9fffA-Za-z0-9·]{1,16})"
    r"(?P<verb>低声问道|高声喊道|哽咽道|迎出来道|出来道|忙道|劝道|问道|叹道|笑道|说道|喊道|叫道|哭道|应道|答道|道|问|说|喊|叫|哭|应|答)"
    r"[，,。；;：:]?$"
)


def _resolve_step2_batch_size(
    *,
    llm_options: dict[str, Any] | None,
    backend_name: str,
    total_segments: int,
) -> int:
    opts = llm_options or {}
    raw_override = opts.get("step2_batch_size", opts.get("two_step_step2_batch_size", 0))
    try:
        override = int(raw_override or 0)
    except Exception:
        override = 0
    if override > 0:
        return max(1, override)

    if backend_name in {"gemini", "openai"}:
        # API backends are more stable when Step2 is split for long scripts.
        # Keep short scripts single-batch to reduce round trips.
        return max(1, min(total_segments, 64))

    if backend_name != "llama-cpp-python":
        return max(1, total_segments)

    try:
        n_ctx = int(opts.get("n_ctx", 8192) or 8192)
    except Exception:
        n_ctx = 8192

    if n_ctx <= 4096:
        return 24
    if n_ctx <= 8192:
        return 36
    if n_ctx <= 16384:
        return 64
    return 96


async def run_two_step_parse_pipeline(
    *,
    text: str,
    prompt: str | None,
    on_chunk: ChunkCallback | None,
    on_chunk_progress: ChunkProgressCallback | None,
    on_chunk_start: ChunkProgressCallback | None,
    llm_options: dict[str, Any] | None,
    on_stage: StageCallback | None,
    backend_name: str,
    resolve_chunk_chars: ResolveChunkChars,
    parse_step1_raw_with_stats: ParseStep1RawWithStats,
    parse_single_with_profile: ParseSingleWithProfile,
    structure_extraction_prompt: str,
    tts_extraction_prompt: str,
    tts_schema: dict[str, Any],
    logger: Any,
    structure_schema: dict[str, Any] | None = None,
) -> tuple[Script, dict[str, Any]]:
    started = time.perf_counter()
    max_chunk_chars = resolve_chunk_chars(llm_options or {})

    if on_stage is not None:
        await on_stage("step1_structure", "Step 1：解析文本结构与角色", 12)

    async def _parse_step1(
        chunk_text: str,
        chunk_prompt: str | None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> tuple[Script, dict[str, Any]]:
        raw_text, raw_stats = await parse_step1_raw_with_stats(
            text=chunk_text,
            prompt=chunk_prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=structure_extraction_prompt,
        )
        draft = parse_step1_lines_to_structured_draft(raw_text, source_text=chunk_text)
        parsed_script = structured_draft_to_script(draft, source_text=chunk_text)
        stats = dict(raw_stats or {})
        stats["step1_line_count"] = len(draft.segments)
        return parsed_script, stats

    step1_script, step1_stats = await run_chunked_parse_flow(
        text=text,
        prompt=prompt,
        on_chunk=on_chunk,
        on_chunk_progress=on_chunk_progress,
        on_chunk_start=on_chunk_start,
        llm_options=llm_options,
        max_chunk_chars=max_chunk_chars,
        backend_name=backend_name,
        parse_single_with_stats=_parse_step1,
        logger=logger,
    )
    structure_draft = to_structured_draft(step1_script, source_text=text)

    if on_stage is not None:
        await on_stage("step1_structure", "Step 1 完成，准备注入 TTS 参数", 55)
        await on_stage("step2_tts", "Step 2：注入 TTS 参数并格式化", 64)

    if backend_name == "mock":
        step2_script = build_mock_tts_enrichment_script(step1_script, source_text=text)
        step2_stats = {
            "mode": "mock_passthrough",
            "backend": "mock",
            "attempts": 0,
            "repair_used": False,
            "fallback": False,
            "duration_ms": 0,
        }
    else:
        step2_started = time.perf_counter()
        total_segments = len(structure_draft.segments)
        batch_size = _resolve_step2_batch_size(
            llm_options=llm_options,
            backend_name=backend_name,
            total_segments=total_segments,
        )
        total_batches = max(1, (total_segments + batch_size - 1) // batch_size)
        batch_items: list[dict[str, Any]] = []

        if total_batches <= 1:
            step2_input = build_step2_input_payload(structure_draft)
            step2_script, single_stats = await parse_single_with_profile(
                text=json.dumps(step2_input, ensure_ascii=False),
                prompt=prompt,
                on_chunk=on_chunk,
                llm_options=llm_options,
                extraction_prompt=tts_extraction_prompt,
                schema=tts_schema,
            )
            step2_stats = dict(single_stats or {})
            step2_stats.update(
                {
                    "mode": "single_batch",
                    "backend": backend_name,
                    "batch_count": 1,
                    "batch_size": batch_size,
                    "batches": [],
                }
            )
        else:
            enriched_by_index: dict[int, Segment] = {}
            metadata_merged: dict[str, Any] = {}
            characters_merged: list[Character] = []
            for batch_idx in range(total_batches):
                start_idx = batch_idx * batch_size
                end_idx = min(total_segments, start_idx + batch_size)
                if on_stage is not None:
                    progress = 64 + int((batch_idx / max(total_batches, 1)) * 24)
                    await on_stage(
                        "step2_tts",
                        f"Step 2：注入 TTS 参数并格式化 ({batch_idx + 1}/{total_batches})",
                        progress,
                    )
                batch_payload = build_step2_input_payload(
                    structure_draft,
                    start_index=start_idx,
                    end_index=end_idx,
                )
                batch_parse_started = time.perf_counter()
                batch_script, batch_stats = await parse_single_with_profile(
                    text=json.dumps(batch_payload, ensure_ascii=False),
                    prompt=prompt,
                    on_chunk=on_chunk,
                    llm_options=llm_options,
                    extraction_prompt=tts_extraction_prompt,
                    schema=tts_schema,
                )
                requested_indices = set(range(start_idx, end_idx))
                accepted_count = 0
                ignored_count = 0
                for segment in batch_script.segments:
                    seg_index = int(segment.index)
                    if seg_index not in requested_indices:
                        ignored_count += 1
                        continue
                    enriched_by_index[seg_index] = segment
                    accepted_count += 1
                metadata_merged.update(dict(batch_script.metadata or {}))
                if batch_script.characters:
                    characters_merged = batch_script.characters
                batch_item = {
                    "batch": batch_idx + 1,
                    "start_index": start_idx,
                    "end_index": end_idx - 1,
                    "segment_count": end_idx - start_idx,
                    "accepted_segments": accepted_count,
                    "ignored_segments": ignored_count,
                    "duration_ms": int((time.perf_counter() - batch_parse_started) * 1000),
                    "repair_used": bool((batch_stats or {}).get("repair_used", False)),
                    "fallback": bool((batch_stats or {}).get("fallback", False)),
                }
                batch_items.append(batch_item)
                if on_stage is not None:
                    progress = 64 + int(((batch_idx + 1) / max(total_batches, 1)) * 24)
                    await on_stage(
                        "step2_tts",
                        f"Step 2：注入 TTS 参数并格式化 ({batch_idx + 1}/{total_batches})",
                        progress,
                    )

            merged_segments: list[Segment] = []
            missing_enriched_count = 0
            for idx, draft_segment in enumerate(structure_draft.segments):
                enriched = enriched_by_index.get(idx)
                if enriched is None:
                    missing_enriched_count += 1
                    merged_segments.append(
                        Segment(
                            id=str(draft_segment.id),
                            index=draft_segment.index,
                            type=draft_segment.type,
                            speaker=draft_segment.speaker,
                            text=draft_segment.text,
                            emotion="neutral",
                            non_verbal=[],
                            tts_overrides={},
                        )
                    )
                    continue
                merged_segments.append(
                    Segment(
                        id=str(draft_segment.id),
                        index=draft_segment.index,
                        type=enriched.type,
                        speaker=enriched.speaker,
                        text=enriched.text,
                        emotion=enriched.emotion,
                        non_verbal=list(enriched.non_verbal or []),
                        tts_overrides=dict(enriched.tts_overrides or {}),
                    )
                )

            step2_script = Script(
                title=step1_script.title,
                source_text=text,
                segments=merged_segments,
                characters=characters_merged
                or [
                    Character(
                        name=character.name,
                        description=character.description,
                        appearance_count=character.appearance_count,
                    )
                    for character in structure_draft.characters
                ],
                metadata=metadata_merged,
            )
            step2_stats = {
                "mode": "batched",
                "backend": backend_name,
                "batch_count": total_batches,
                "batch_size": batch_size,
                "batches": batch_items,
                "missing_enriched_count": missing_enriched_count,
                "repair_used": any(item["repair_used"] for item in batch_items),
                "fallback": any(item["fallback"] for item in batch_items),
                "duration_ms": int((time.perf_counter() - step2_started) * 1000),
            }

    structure_guard = analyze_two_step_structure_drift(structure_draft, step2_script)
    step2_stats["structure_guard"] = structure_guard
    if structure_guard["segment_count_changed"] or structure_guard["mismatch_count"] > 0:
        logger.warning(
            "Two-step structure drift detected: count_changed=%s mismatch_count=%s compatible_count=%s mismatched_indices=%s. "
            "Using Step1 structure as source of truth with partial Step2 enrichment for compatible segments.",
            structure_guard["segment_count_changed"],
            structure_guard["mismatch_count"],
            structure_guard.get("compatible_count", 0),
            structure_guard["mismatched_indices"],
        )
    final_script = merge_two_step_output(
        structure_draft=structure_draft,
        tts_script=step2_script,
        source_text=text,
        structure_guard=structure_guard,
    )

    if on_stage is not None:
        await on_stage("finalizing", "正在整理最终解析结果", 94)

    total_duration_ms = int((time.perf_counter() - started) * 1000)
    repair_used_count = int(step1_stats.get("repair_used_count", 0)) + (1 if step2_stats.get("repair_used") else 0)
    fallback_count = int(step1_stats.get("fallback_count", 0)) + (1 if step2_stats.get("fallback") else 0)
    parse_stats = {
        "mode": "two_step",
        "backend": backend_name,
        "total_chunks": int(step1_stats.get("total_chunks", 1)),
        "duration_ms": total_duration_ms,
        "repair_used_count": repair_used_count,
        "fallback_count": fallback_count,
        "chunk_stats": step1_stats.get("chunk_stats", []),
        "step_stats": {
            "step1_structure": step1_stats,
            "step2_tts": step2_stats,
        },
        "structure_guard": structure_guard,
    }
    logger.info(
        "LLM parse completed mode=two_step backend=%s chunks=%s duration_ms=%s repair_count=%s fallback_count=%s",
        backend_name,
        parse_stats["total_chunks"],
        total_duration_ms,
        repair_used_count,
        fallback_count,
    )
    return final_script, parse_stats


def normalize_non_verbal_tag(tag: str) -> tuple[str, str]:
    raw = (tag or "").strip()
    if not raw:
        return "", ""
    bracketed = raw if raw.startswith("[") and raw.endswith("]") else f"[{raw}]"
    bare = bracketed[1:-1].strip()
    return bracketed, bare


def apply_non_verbal_tags_to_text(text: str, non_verbal: list[str]) -> str:
    base_text = (text or "").strip()
    if not non_verbal:
        return base_text
    existing = set(_NON_VERBAL_RE.findall(base_text))
    prepend: list[str] = []
    for item in non_verbal:
        bracketed, bare = normalize_non_verbal_tag(str(item))
        if not bracketed or not bare:
            continue
        if bare in existing:
            continue
        prepend.append(bracketed)
        existing.add(bare)
    if not prepend:
        return base_text
    return f"{' '.join(prepend)} {base_text}".strip()


def _extract_non_verbal_tags_from_text(text: str) -> list[str]:
    tags = _NON_VERBAL_RE.findall(text or "")
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        bracketed, bare = normalize_non_verbal_tag(tag)
        if not bracketed or bare in seen:
            continue
        normalized.append(bracketed)
        seen.add(bare)
    return normalized


def _normalize_non_verbal_items(items: list[str], text: str = "") -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    merged_items = [str(item) for item in (items or [])]
    merged_items.extend(_extract_non_verbal_tags_from_text(text))
    for item in merged_items:
        bracketed, bare = normalize_non_verbal_tag(item)
        if not bracketed or bare in seen:
            continue
        if bare not in _ALLOWED_NON_VERBAL_BARE:
            continue
        normalized.append(bracketed)
        seen.add(bare)
    return normalized


def _strip_non_verbal_tags(text: str) -> str:
    return re.sub(r"\[[^\[\]]+\]", "", text or "")


def _strip_unknown_non_verbal_tags(text: str) -> str:
    def _replace(match: re.Match[str]) -> str:
        bare = (match.group(1) or "").strip()
        return match.group(0) if bare in _ALLOWED_NON_VERBAL_BARE else ""

    return _NON_VERBAL_RE.sub(_replace, text or "")


def _strip_pinyin_annotations(text: str) -> str:
    return _PINYIN_ANNOTATION_RE.sub(r"\1", text or "")


def _normalize_compare_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "").strip()


def _is_pure_non_verbal_text(text: str) -> bool:
    value = (text or "").strip()
    if not value:
        return False
    without_tags = _NON_VERBAL_RE.sub("", value)
    without_tags = re.sub(r"\s+", "", without_tags)
    return without_tags == ""


def _source_contains_non_verbal_tags(source_text: str, content: str) -> bool:
    source = source_text or ""
    tags = _extract_non_verbal_tags_from_text(content)
    if not tags:
        return False
    return all(tag in source for tag in tags)


def _is_step2_text_compatible(base_text: str, candidate_text: str) -> bool:
    candidate = (candidate_text or "").strip()
    if not candidate:
        return False
    cleaned = _strip_pinyin_annotations(_strip_non_verbal_tags(candidate))
    return _normalize_compare_text(cleaned) == _normalize_compare_text(base_text)


def _sanitize_tts_overrides(raw_overrides: dict[str, Any] | None) -> dict[str, str | int | float | bool]:
    if not isinstance(raw_overrides, dict):
        return {}
    sanitized: dict[str, str | int | float | bool] = {}
    for key, value in raw_overrides.items():
        key_str = str(key)
        if key_str not in _TTS_OVERRIDE_ALLOWED_KEYS:
            continue
        if isinstance(value, (str, int, float, bool)):
            sanitized[key_str] = value
    return sanitized


def _strip_wrapping_quotes(text: str) -> str:
    value = (text or "").strip()
    if len(value) < 2:
        return value
    quote_pairs = {
        ("“", "”"),
        ("\"", "\""),
        ("‘", "’"),
        ("'", "'"),
        ("「", "」"),
        ("『", "』"),
    }
    for left, right in quote_pairs:
        if value.startswith(left) and value.endswith(right):
            return value[1:-1].strip()
    return value


def _split_dialogue_leadin_speaker(speaker: str) -> tuple[str, str] | None:
    value = (speaker or "").strip()
    if not value:
        return None
    for suffix in _SPEECH_LEADIN_SUFFIXES:
        if value.endswith(suffix):
            base = value[: -len(suffix)].strip()
            if base:
                return base, suffix
    return None


def _looks_like_bad_speaker(token: str) -> bool:
    value = (token or "").strip()
    if not value:
        return True
    if any(ch in value for ch in "，,。；;！？!?：:\"'“”‘’（）()[]【】"):
        return True
    if len(value) > 24:
        return True
    return False


def _extract_speaker_from_leadin_base(base: str) -> str:
    value = (base or "").strip()
    if not value:
        return "有人"
    if value == "有人":
        return "有人"

    for trail in _ACTION_TRAILING_WORDS:
        if value.endswith(trail) and len(value) > len(trail):
            candidate = value[: -len(trail)].strip()
            if candidate and not _looks_like_bad_speaker(candidate):
                value = candidate
                break

    if "，" in value or "," in value:
        cut = re.split(r"[，,]", value)[0].strip()
        if cut:
            value = cut

    matched = _LEADING_SPEAKER_CUT_RE.match(value)
    if matched:
        head = matched.group(1).strip()
        if head and not _looks_like_bad_speaker(head):
            return head

    if not _looks_like_bad_speaker(value):
        return value
    return "有人"


def _extract_speaker_from_attribution_tail(text: str) -> str | None:
    value = (text or "").strip()
    if not value:
        return None
    if any(sep in value for sep in ("，", ",")):
        value = re.split(r"[，,]", value)[-1].strip()
    while value and value[-1] in "。！？!?；;：:":
        value = value[:-1].strip()
    if not value:
        return None

    patterns = [
        r"^(?P<speaker>[\u4e00-\u9fffA-Za-z0-9·]{1,16})对(?:他|她|他们|她们)?说$",
        r"^(?P<speaker>[\u4e00-\u9fffA-Za-z0-9·]{1,16})对(?:他|她|他们|她们)?道$",
        r"^(?P<speaker>[\u4e00-\u9fffA-Za-z0-9·]{1,16})(?:说道|说|问道|问|喊道|喊|叫道|叫|答道|答|应道|应)$",
    ]
    for pattern in patterns:
        matched = re.match(pattern, value)
        if not matched:
            continue
        speaker = (matched.group("speaker") or "").strip()
        if speaker and not _looks_like_bad_speaker(speaker):
            return speaker
    return None


def _try_split_inline_quote_then_attribution(content: str) -> tuple[str, str, str] | None:
    value = (content or "").strip()
    if not value:
        return None
    matched = _INLINE_QUOTE_ATTR_RE.match(value)
    if not matched:
        return None
    quote_text = (matched.group("quote") or "").strip()
    attr = (matched.group("attr") or "").strip()
    if not quote_text or not attr:
        return None

    attr_clean = attr
    while attr_clean and attr_clean[-1] in "，,。；;：:":
        attr_clean = attr_clean[:-1].strip()
    attr_speaker = _ATTR_SPEAKER_RE.match(attr_clean)
    if not attr_speaker:
        return None

    speaker = (attr_speaker.group("speaker") or "").strip()
    verb = (attr_speaker.group("verb") or "").strip()
    if not speaker or not verb:
        return None
    narration_text = f"{speaker}{verb}。"
    return quote_text, narration_text, speaker


def _try_split_leading_quote_with_context_attribution(content: str) -> tuple[str, str, str] | None:
    value = (content or "").strip()
    if not value:
        return None
    matched = _LEADING_QUOTE_WITH_CONTEXT_RE.match(value)
    if not matched:
        return None
    quote_text = (matched.group("quote") or "").strip()
    rest = (matched.group("rest") or "").strip()
    if not quote_text or not rest:
        return None
    speaker = _extract_speaker_from_attribution_tail(rest)
    if not speaker:
        return None
    return quote_text, rest, speaker


def _is_dialogue_leadin_narration(text: str) -> bool:
    value = (text or "").strip()
    if not value:
        return False
    return bool(_DIALOGUE_LEADIN_RE.search(value))


def _split_step1_prefixed_line(line: str, line_no: int) -> tuple[str, str, str]:
    if line.startswith("旁白：") or line.startswith("旁白:"):
        text = line.split("：", 1)[1] if "：" in line else line.split(":", 1)[1]
        content = text.strip()
        if not content:
            raise ValueError(f"Step1 line parse error at line {line_no}: narration content is empty")
        return "narration", "narrator", content
    if line.startswith("舞台提示：") or line.startswith("舞台提示:"):
        text = line.split("：", 1)[1] if "：" in line else line.split(":", 1)[1]
        content = text.strip()
        if not content:
            raise ValueError(f"Step1 line parse error at line {line_no}: direction content is empty")
        return "direction", "narrator", content

    matched = _PREF_LINE_SPEAKER_RE.match(line)
    if not matched:
        snippet = line[:40]
        raise ValueError(f"Step1 line parse error at line {line_no}: invalid prefix format `{snippet}`")
    speaker = matched.group("speaker").strip()
    content = matched.group("text").strip()
    if not speaker:
        raise ValueError(f"Step1 line parse error at line {line_no}: speaker is empty")
    if not content:
        raise ValueError(f"Step1 line parse error at line {line_no}: dialogue content is empty")
    return "dialogue", speaker, content


def parse_step1_lines_to_structured_draft(raw_text: str, source_text: str, title: str = "未命名剧本") -> StructuredScriptDraft:
    lines = (raw_text or "").splitlines()
    if not lines:
        raise ValueError("Step1 line parse error at line 1: empty output")

    segments: list[StructuredSegmentDraft] = []
    counter: Counter[str] = Counter()
    pending_non_verbal_for_dialogue: list[str] = []
    for line_no, original in enumerate(lines, start=1):
        line = (original or "").strip()
        if not line:
            raise ValueError(f"Step1 line parse error at line {line_no}: empty line is not allowed")
        seg_type, speaker, content = _split_step1_prefixed_line(line, line_no)
        if _is_pure_non_verbal_text(content) and not _source_contains_non_verbal_tags(source_text, content):
            # Step1 偶发幻觉出纯标签行（如 [laughter]）：不落成段，迁移到后续最近一条 dialogue。
            pending_non_verbal_for_dialogue.extend(_extract_non_verbal_tags_from_text(content))
            continue
        if seg_type == "narration":
            inline_split = _try_split_inline_quote_then_attribution(content)
            if inline_split is not None:
                quote_text, narration_text, dialogue_speaker = inline_split
                if pending_non_verbal_for_dialogue:
                    quote_text = apply_non_verbal_tags_to_text(quote_text, pending_non_verbal_for_dialogue)
                    pending_non_verbal_for_dialogue.clear()
                segments.append(
                    StructuredSegmentDraft(
                        id=str(uuid4()),
                        index=len(segments),
                        type="dialogue",
                        speaker=dialogue_speaker,
                        text=quote_text,
                    )
                )
                counter[dialogue_speaker] += 1
                segments.append(
                    StructuredSegmentDraft(
                        id=str(uuid4()),
                        index=len(segments),
                        type="narration",
                        speaker="narrator",
                        text=narration_text,
                    )
                )
                counter["narrator"] += 1
                continue
            lead_quote_split = _try_split_leading_quote_with_context_attribution(content)
            if lead_quote_split is not None:
                quote_text, narration_text, dialogue_speaker = lead_quote_split
                if pending_non_verbal_for_dialogue:
                    quote_text = apply_non_verbal_tags_to_text(quote_text, pending_non_verbal_for_dialogue)
                    pending_non_verbal_for_dialogue.clear()
                segments.append(
                    StructuredSegmentDraft(
                        id=str(uuid4()),
                        index=len(segments),
                        type="dialogue",
                        speaker=dialogue_speaker,
                        text=quote_text,
                    )
                )
                counter[dialogue_speaker] += 1
                segments.append(
                    StructuredSegmentDraft(
                        id=str(uuid4()),
                        index=len(segments),
                        type="narration",
                        speaker="narrator",
                        text=narration_text,
                    )
                )
                counter["narrator"] += 1
                continue
        split_leadin = seg_type == "dialogue" and _split_dialogue_leadin_speaker(speaker)
        if split_leadin:
            leadin_base, suffix = split_leadin
            dialogue_speaker = _extract_speaker_from_leadin_base(leadin_base)
            narration_text = f"{leadin_base}{suffix}："
            dialogue_text = _strip_wrapping_quotes(content)
            segments.append(
                StructuredSegmentDraft(
                    id=str(uuid4()),
                    index=len(segments),
                    type="narration",
                    speaker="narrator",
                    text=narration_text,
                )
            )
            counter["narrator"] += 1
            if dialogue_text:
                if pending_non_verbal_for_dialogue:
                    dialogue_text = apply_non_verbal_tags_to_text(dialogue_text, pending_non_verbal_for_dialogue)
                    pending_non_verbal_for_dialogue.clear()
                segments.append(
                    StructuredSegmentDraft(
                        id=str(uuid4()),
                        index=len(segments),
                        type="dialogue",
                        speaker=dialogue_speaker,
                        text=dialogue_text,
                    )
                )
                counter[dialogue_speaker] += 1
            continue

        if seg_type == "dialogue" and pending_non_verbal_for_dialogue:
            content = apply_non_verbal_tags_to_text(content, pending_non_verbal_for_dialogue)
            pending_non_verbal_for_dialogue.clear()
        segments.append(
            StructuredSegmentDraft(
                id=str(uuid4()),
                index=len(segments),
                type=seg_type,
                speaker=speaker,
                text=content,
            )
        )
        counter[speaker] += 1

    if not segments:
        raise ValueError("Step1 line parse error at line 1: no valid content lines")

    characters: list[StructuredCharacterDraft] = []
    for name, count in counter.items():
        description = "讲述故事的旁白，语调沉稳" if name == "narrator" else f"{name} 的角色档案"
        characters.append(
            StructuredCharacterDraft(
                name=name,
                description=description,
                appearance_count=int(count),
            )
        )

    return StructuredScriptDraft(
        title=title or "未命名剧本",
        source_text=source_text,
        segments=segments,
        characters=characters,
        metadata={"language": "zh", "parser": "step1-line-parser"},
    )


def structured_draft_to_script(draft: StructuredScriptDraft, source_text: str) -> Script:
    return Script(
        title=draft.title or "未命名剧本",
        source_text=source_text,
        segments=[
            Segment(
                id=segment.id,
                index=segment.index,
                type=segment.type,
                speaker=segment.speaker,
                text=segment.text,
                emotion="neutral",
                non_verbal=[],
                tts_overrides={},
            )
            for segment in draft.segments
        ],
        characters=[
            Character(
                name=character.name,
                description=character.description,
                appearance_count=character.appearance_count,
            )
            for character in draft.characters
        ],
        metadata=dict(draft.metadata or {}),
    )


def to_structured_draft(script: Script, source_text: str) -> StructuredScriptDraft:
    return StructuredScriptDraft(
        title=script.title or "未命名剧本",
        source_text=source_text,
        segments=[
            StructuredSegmentDraft(
                id=str(segment.id),
                index=int(segment.index),
                type=segment.type,
                speaker=segment.speaker,
                text=segment.text,
            )
            for segment in script.segments
        ],
        characters=[
            StructuredCharacterDraft(
                name=character.name,
                description=character.description,
                appearance_count=int(character.appearance_count),
            )
            for character in script.characters
        ],
        metadata=dict(script.metadata or {}),
    )


def build_step2_input_payload(
    structure_draft: StructuredScriptDraft,
    *,
    start_index: int | None = None,
    end_index: int | None = None,
) -> dict[str, Any]:
    segments = structure_draft.segments[slice(start_index, end_index)]
    batch_source_text = (
        structure_draft.source_text
        if start_index is None and end_index is None
        else "\n".join(segment.text for segment in segments)
    )
    return {
        "title": structure_draft.title,
        "source_text": batch_source_text,
        "segments": [
            {
                "index": segment.index,
                "type": segment.type,
                "speaker": segment.speaker,
                "text": segment.text,
            }
            for segment in segments
        ],
        "character_descriptions": {
            character.name: character.description
            for character in structure_draft.characters
            if character.name
        },
        "metadata": dict(structure_draft.metadata or {}),
    }


def build_mock_tts_enrichment_script(structure_script: Script, source_text: str) -> Script:
    return Script(
        title=structure_script.title,
        source_text=source_text,
        segments=[
            Segment(
                id=segment.id,
                index=segment.index,
                type=segment.type,
                speaker=segment.speaker,
                text=segment.text,
                emotion=segment.emotion or "neutral",
                non_verbal=[],
                tts_overrides={},
            )
            for segment in structure_script.segments
        ],
        characters=[Character.model_validate(character.model_dump(mode="json")) for character in structure_script.characters],
        metadata=dict(structure_script.metadata or {}),
    )


def _build_step2_segment_index_map(tts_script: Script) -> tuple[dict[int, Segment], list[int], list[int]]:
    index_map: dict[int, Segment] = {}
    duplicate_indices: list[int] = []
    invalid_indices: list[int] = []
    total = len(tts_script.segments)
    for segment in tts_script.segments:
        try:
            idx = int(segment.index)
        except Exception:
            invalid_indices.append(-1)
            continue
        if idx < 0 or idx >= total:
            invalid_indices.append(idx)
            continue
        if idx in index_map:
            duplicate_indices.append(idx)
            continue
        index_map[idx] = segment
    return index_map, duplicate_indices, invalid_indices


def analyze_two_step_structure_drift(structure_draft: StructuredScriptDraft, tts_script: Script) -> dict[str, Any]:
    expected_count = len(structure_draft.segments)
    actual_count = len(tts_script.segments)
    expected_by_index = {int(segment.index): segment for segment in structure_draft.segments}
    parsed_by_index, duplicate_indices, invalid_indices = _build_step2_segment_index_map(tts_script)
    mismatched_indices: list[int] = []
    missing_indices: list[int] = []
    compatible_indices: list[int] = []
    for idx in sorted(expected_by_index.keys()):
        draft_segment = expected_by_index[idx]
        parsed = parsed_by_index.get(idx)
        if parsed is None:
            missing_indices.append(idx)
            mismatched_indices.append(idx)
            continue
        if (
            draft_segment.type != parsed.type
            or draft_segment.speaker.strip() != parsed.speaker.strip()
        ):
            mismatched_indices.append(idx)
            continue
        compatible_indices.append(idx)
    return {
        "segment_count_expected": expected_count,
        "segment_count_actual": actual_count,
        "segment_count_changed": expected_count != actual_count,
        "mismatched_indices": mismatched_indices,
        "mismatch_count": len(mismatched_indices),
        "missing_indices": missing_indices,
        "missing_count": len(missing_indices),
        "compatible_indices": compatible_indices,
        "compatible_count": len(compatible_indices),
        "duplicate_indices": sorted(set(duplicate_indices)),
        "duplicate_count": len(set(duplicate_indices)),
        "invalid_indices": invalid_indices,
        "invalid_count": len(invalid_indices),
    }


def merge_two_step_output(
    *,
    structure_draft: StructuredScriptDraft,
    tts_script: Script,
    source_text: str,
    structure_guard: dict[str, Any] | None = None,
) -> Script:
    guard = structure_guard or {}
    merged_segments: list[Segment] = []
    allow_step2_segment_injection = not bool(guard.get("segment_count_changed", False))
    step2_by_index: dict[int, Segment] = {}
    if allow_step2_segment_injection:
        step2_by_index, _duplicate_indices, _invalid_indices = _build_step2_segment_index_map(tts_script)

    def _get_compatible_enriched(idx: int, draft_segment: StructuredSegmentDraft) -> Segment | None:
        if not allow_step2_segment_injection:
            return None
        candidate = step2_by_index.get(idx)
        if candidate is None:
            return None
        if candidate.type != draft_segment.type:
            return None
        if candidate.speaker.strip() != draft_segment.speaker.strip():
            return None
        return candidate

    transferred_non_verbal: dict[int, list[str]] = {}
    muted_narration_indices: set[int] = set()
    if allow_step2_segment_injection:
        for idx, draft_segment in enumerate(structure_draft.segments):
            if draft_segment.type != "narration":
                continue
            if idx + 1 >= len(structure_draft.segments):
                continue
            next_segment = structure_draft.segments[idx + 1]
            if next_segment.type != "dialogue":
                continue
            if not _is_dialogue_leadin_narration(draft_segment.text):
                continue
            enriched = _get_compatible_enriched(idx, draft_segment)
            if enriched is None:
                continue
            narration_tags = _normalize_non_verbal_items(
                [str(item) for item in ((enriched.non_verbal or []) or [])],
                text=(enriched.text or ""),
            )
            if not narration_tags:
                continue
            transferred_non_verbal[idx + 1] = _normalize_non_verbal_items(
                transferred_non_verbal.get(idx + 1, []) + narration_tags
            )
            muted_narration_indices.add(idx)
    for idx, draft_segment in enumerate(structure_draft.segments):
        enriched = _get_compatible_enriched(idx, draft_segment)
        candidate_text = (enriched.text if enriched is not None else "").strip()
        non_verbal_items = _normalize_non_verbal_items(
            [str(item) for item in ((enriched.non_verbal if enriched is not None else []) or [])],
            text=f"{candidate_text} {draft_segment.text}",
        )
        if idx in muted_narration_indices:
            non_verbal_items = []
        if idx in transferred_non_verbal:
            non_verbal_items = _normalize_non_verbal_items(non_verbal_items + transferred_non_verbal[idx])
        text_base = (
            candidate_text
            if enriched is not None and _is_step2_text_compatible(draft_segment.text, candidate_text)
            else draft_segment.text
        )
        text_base = _strip_unknown_non_verbal_tags(text_base).strip()
        if idx in muted_narration_indices:
            text_base = _strip_non_verbal_tags(text_base).strip()
        merged_text = apply_non_verbal_tags_to_text(text_base, non_verbal_items)
        merged_segments.append(
            Segment(
                id=str(draft_segment.id),
                index=draft_segment.index,
                type=draft_segment.type,
                speaker=draft_segment.speaker,
                text=merged_text,
                emotion=((enriched.emotion if enriched is not None else "neutral") or "neutral").strip() or "neutral",
                non_verbal=non_verbal_items,
                tts_overrides=_sanitize_tts_overrides(enriched.tts_overrides if enriched is not None else {}),
            )
        )
    metadata = dict(structure_draft.metadata or {})
    metadata.update(dict(tts_script.metadata or {}))
    metadata["parse_pipeline"] = "two_step"
    use_step2_characters = allow_step2_segment_injection and int(guard.get("mismatch_count", 0)) == 0
    final_characters = (tts_script.characters if use_step2_characters else []) or [
        Character(
            name=character.name,
            description=character.description,
            appearance_count=character.appearance_count,
        )
        for character in structure_draft.characters
    ]
    return Script(
        title=structure_draft.title or tts_script.title or "未命名剧本",
        source_text=source_text,
        segments=merged_segments,
        characters=final_characters,
        metadata=metadata,
    )
