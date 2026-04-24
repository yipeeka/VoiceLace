from __future__ import annotations

import json
import re
import time
from collections import Counter
from typing import Any, Awaitable, Callable
from uuid import uuid4

from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.engine.llm_two_step_pipeline import (
    _build_source_corrected_draft,
    _extract_non_verbal_tags_from_text,
    _split_step1_prefixed_line,
    analyze_two_step_structure_drift,
    merge_two_step_output,
    parse_step1_lines_to_structured_draft,
    structured_draft_to_script,
    to_structured_draft,
)
from backend.models import Character, Script, Segment, StructuredCharacterDraft, StructuredScriptDraft

ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]
StageCallback = Callable[[str, str, int], Awaitable[None]]
ResolveChunkChars = Callable[[dict[str, Any]], int]
ParseStepRawWithStats = Callable[
    ...,
    Awaitable[tuple[str, dict[str, Any]]],
]

_EMOTION_VALUES = {
    "neutral",
    "cheerful",
    "sad",
    "angry",
    "fearful",
    "surprise",
    "melancholy",
    "tender",
    "serious",
    "playful",
    "concern",
    "excited",
}
_EMOTION_PREFIX_RE = re.compile(
    r"^\s*[（(]\s*"
    r"(?P<emotion>neutral|cheerful|sad|angry|fearful|surprise|melancholy|tender|serious|playful|concern|excited)"
    r"\s*[）)]\s*",
    re.IGNORECASE,
)


def _segment_prefix(segment_type: str, speaker: str) -> str:
    if segment_type == "narration":
        return "旁白"
    if segment_type == "direction":
        return "舞台提示"
    return speaker or "有人"


def draft_to_prefixed_lines(draft: StructuredScriptDraft) -> str:
    lines = [
        f"{_segment_prefix(segment.type, segment.speaker)}：{(segment.text or '').strip()}"
        for segment in draft.segments
        if (segment.text or "").strip()
    ]
    return "\n".join(lines)


def _script_to_prefixed_lines(script: Script) -> str:
    lines = [
        f"{_segment_prefix(segment.type, segment.speaker)}：{(segment.text or '').strip()}"
        for segment in script.segments
        if (segment.text or "").strip()
    ]
    return "\n".join(lines)


def _log_verified_step_result(logger: Any, step_name: str, content: str, *, max_chars: int = 120000) -> None:
    text = content or ""
    truncated = len(text) > max_chars
    visible = text[:max_chars]
    suffix = f"\n[TRUNCATED {len(text) - max_chars} chars]" if truncated else ""
    logger.info(
        "\n========== verified_five_step %s result ==========\n%s%s\n========== end %s ==========",
        step_name,
        visible,
        suffix,
        step_name,
    )


def _empty_fallback_draft(*, source_text: str, title: str) -> StructuredScriptDraft:
    return StructuredScriptDraft(
        title=title or "未命名剧本",
        source_text=source_text,
        segments=[],
        characters=[],
        metadata={"language": "zh", "parser": "verified-five-step-empty"},
    )


def _segment_signature(segment_type: str, speaker: str, text: str) -> tuple[str, str, str]:
    return segment_type, (speaker or "").strip(), (text or "").strip()


def _speaker_preserve_match_key(text: str) -> str:
    return re.sub(r"[，,。？！!?；;：:、“”\"'‘’\s]", "", text or "")


def _preserve_step1_dialogue_speakers(
    *,
    corrected_draft: StructuredScriptDraft,
    step1_draft: StructuredScriptDraft,
) -> int:
    """Keep Step1 speakers when Step2 verification only changed speaker names.

    The source verifier may re-derive speakers from narration lead-ins. When Step1
    already produced the same dialogue text at the same position, its speaker is
    the safer truth because it came from the model's explicit prefixed line.
    """
    changed_count = 0
    compared_len = min(len(corrected_draft.segments), len(step1_draft.segments))
    for idx in range(compared_len):
        corrected = corrected_draft.segments[idx]
        original = step1_draft.segments[idx]
        if corrected.type != "dialogue" or original.type != "dialogue":
            continue
        if corrected.type != original.type:
            continue
        if _speaker_preserve_match_key(corrected.text) != _speaker_preserve_match_key(original.text):
            continue
        original_speaker = (original.speaker or "").strip()
        if not original_speaker:
            continue
        if (corrected.speaker or "").strip() == original_speaker:
            continue
        corrected.speaker = original_speaker
        changed_count += 1
    step1_dialogues = [segment for segment in step1_draft.segments if segment.type == "dialogue"]
    search_start = 0
    for corrected in corrected_draft.segments:
        if corrected.type != "dialogue":
            continue
        if search_start >= len(step1_dialogues):
            break
        corrected_key = _speaker_preserve_match_key(corrected.text)
        if not corrected_key:
            continue
        for candidate_index in range(search_start, len(step1_dialogues)):
            candidate = step1_dialogues[candidate_index]
            candidate_key = _speaker_preserve_match_key(candidate.text)
            if not candidate_key or corrected_key != candidate_key:
                continue
            candidate_speaker = (candidate.speaker or "").strip()
            if candidate_speaker and (corrected.speaker or "").strip() != candidate_speaker:
                corrected.speaker = candidate_speaker
                changed_count += 1
            search_start = candidate_index + 1
            break
    return changed_count


def _scan_source_coverage(*, source_text: str, segments: list[Segment]) -> dict[str, int]:
    source = (source_text or "").replace("\u3000", "").strip()
    cursor = 0
    missing_count = 0
    out_of_order_count = 0
    for segment in segments:
        content = (segment.text or "").strip()
        if not content:
            continue
        position = source.find(content, cursor)
        if position >= 0:
            cursor = position + len(content)
            continue
        fallback_position = source.find(content)
        if fallback_position >= 0:
            out_of_order_count += 1
            cursor = max(cursor, fallback_position + len(content))
        else:
            missing_count += 1
    return {
        "coverage_missing_count": missing_count,
        "coverage_out_of_order_count": out_of_order_count,
    }


def _should_use_source_corrected_step2(
    *,
    step1_draft: StructuredScriptDraft,
    corrected_draft: StructuredScriptDraft,
    source_text: str,
) -> tuple[bool, dict[str, Any]]:
    step1_script = structured_draft_to_script(step1_draft, source_text=source_text)
    corrected_script = structured_draft_to_script(corrected_draft, source_text=source_text)
    step1_coverage = _scan_source_coverage(source_text=source_text, segments=step1_script.segments)
    corrected_coverage = _scan_source_coverage(source_text=source_text, segments=corrected_script.segments)
    step1_missing = int(step1_coverage.get("coverage_missing_count", 0) or 0)
    corrected_missing = int(corrected_coverage.get("coverage_missing_count", 0) or 0)
    step1_out_of_order = int(step1_coverage.get("coverage_out_of_order_count", 0) or 0)
    corrected_out_of_order = int(corrected_coverage.get("coverage_out_of_order_count", 0) or 0)
    source_dialogue_count = len(re.findall(r"[“\"][^”\"]+[”\"]", source_text or ""))
    step1_dialogue_count = sum(1 for segment in step1_draft.segments if segment.type == "dialogue")
    corrected_dialogue_count = sum(1 for segment in corrected_draft.segments if segment.type == "dialogue")
    step1_valid_segment_count = sum(1 for segment in step1_draft.segments if (segment.text or "").strip())
    corrected_valid_segment_count = sum(1 for segment in corrected_draft.segments if (segment.text or "").strip())

    # Step2 is a verifier, not a second parser. The source-corrected draft is
    # useful as diagnostics, but rebuilding from source collapses Step1's
    # natural line breaks and can misread quoted terms as dialogue. Only use it
    # as an emergency fallback when Step1 produced no usable text at all.
    use_corrected = step1_valid_segment_count == 0 and corrected_valid_segment_count > 0
    source_corrected_reason = "step1_empty_fallback" if use_corrected else "step1_preserved"
    return use_corrected, {
        "step1_coverage_missing_count": step1_missing,
        "corrected_coverage_missing_count": corrected_missing,
        "step1_coverage_out_of_order_count": step1_out_of_order,
        "corrected_coverage_out_of_order_count": corrected_out_of_order,
        "source_dialogue_count": source_dialogue_count,
        "step1_dialogue_count": step1_dialogue_count,
        "corrected_dialogue_count": corrected_dialogue_count,
        "step1_valid_segment_count": step1_valid_segment_count,
        "corrected_valid_segment_count": corrected_valid_segment_count,
        "source_corrected_reason": source_corrected_reason,
        "used_source_corrected": use_corrected,
    }


def verify_step1_script_with_source(
    *,
    step1_script: Script,
    source_text: str,
) -> tuple[StructuredScriptDraft, dict[str, Any]]:
    step1_draft = to_structured_draft(step1_script, source_text=source_text)
    step1_valid_segment_count = sum(1 for segment in step1_draft.segments if (segment.text or "").strip())
    if step1_valid_segment_count > 0:
        coverage_report = _scan_source_coverage(
            source_text=source_text,
            segments=structured_draft_to_script(step1_draft, source_text=source_text).segments,
        )
        return step1_draft, {
            "changed": False,
            "segment_count_before": len(step1_draft.segments),
            "segment_count_after": len(step1_draft.segments),
            "missing_count": 0,
            "duplicate_count": 0,
            "out_of_order_count": 0,
            "speaker_preserved_count": 0,
            "invalid_prefix_count": 0,
            "step1_valid_segment_count": step1_valid_segment_count,
            "corrected_valid_segment_count": 0,
            "source_corrected_reason": "step1_preserved_hard_guard",
            "used_source_corrected": False,
            **coverage_report,
        }
    corrected_draft = _build_source_corrected_draft(
        source_text,
        title=step1_draft.title or "未命名剧本",
        fallback_draft=step1_draft,
    )
    use_corrected, selection_report = _should_use_source_corrected_step2(
        step1_draft=step1_draft,
        corrected_draft=corrected_draft,
        source_text=source_text,
    )
    if not use_corrected:
        coverage_report = _scan_source_coverage(
            source_text=source_text,
            segments=structured_draft_to_script(step1_draft, source_text=source_text).segments,
        )
        return step1_draft, {
            "changed": False,
            "segment_count_before": len(step1_draft.segments),
            "segment_count_after": len(step1_draft.segments),
            "missing_count": 0,
            "duplicate_count": 0,
            "out_of_order_count": 0,
            "speaker_preserved_count": 0,
            "invalid_prefix_count": 0,
            **coverage_report,
            **selection_report,
        }
    speaker_preserved_count = _preserve_step1_dialogue_speakers(
        corrected_draft=corrected_draft,
        step1_draft=step1_draft,
    )
    step1_counter = Counter(
        _segment_signature(segment.type, segment.speaker, segment.text)
        for segment in step1_draft.segments
    )
    corrected_counter = Counter(
        _segment_signature(segment.type, segment.speaker, segment.text)
        for segment in corrected_draft.segments
    )
    missing_count = sum(
        max(0, corrected_counter[signature] - step1_counter.get(signature, 0))
        for signature in corrected_counter
    )
    duplicate_count = sum(
        max(0, step1_counter[signature] - corrected_counter.get(signature, 0))
        for signature in step1_counter
    )
    compared_len = min(len(step1_draft.segments), len(corrected_draft.segments))
    out_of_order_count = sum(
        1
        for idx in range(compared_len)
        if _segment_signature(
            step1_draft.segments[idx].type,
            step1_draft.segments[idx].speaker,
            step1_draft.segments[idx].text,
        )
        != _segment_signature(
            corrected_draft.segments[idx].type,
            corrected_draft.segments[idx].speaker,
            corrected_draft.segments[idx].text,
        )
    )
    coverage_report = _scan_source_coverage(
        source_text=source_text,
        segments=structured_draft_to_script(corrected_draft, source_text=source_text).segments,
    )
    return corrected_draft, {
        "changed": bool(
            missing_count
            or duplicate_count
            or out_of_order_count
            or speaker_preserved_count
            or len(step1_draft.segments) != len(corrected_draft.segments)
        ),
        "segment_count_before": len(step1_draft.segments),
        "segment_count_after": len(corrected_draft.segments),
        "missing_count": int(missing_count),
        "duplicate_count": int(duplicate_count),
        "out_of_order_count": int(out_of_order_count),
        "speaker_preserved_count": int(speaker_preserved_count),
        "invalid_prefix_count": 0,
        **selection_report,
        **coverage_report,
    }


def _characters_from_segments(segments: list[Segment]) -> list[Character]:
    counts: Counter[str] = Counter(segment.speaker for segment in segments if segment.speaker)
    characters: list[Character] = []
    for name, count in counts.items():
        characters.append(
            Character(
                name=name,
                description="讲述故事的旁白，语调沉稳" if name == "narrator" else f"{name} 的角色档案",
                appearance_count=int(count),
                voice_preset_id=None,
            )
        )
    return characters


def parse_step3_enriched_lines_to_script(
    raw_text: str,
    *,
    source_text: str,
    title: str = "未命名剧本",
) -> Script:
    lines = (raw_text or "").splitlines()
    if not lines:
        raise ValueError("Step3 line parse error at line 1: empty output")
    segments: list[Segment] = []
    for line_no, original in enumerate(lines, start=1):
        line = (original or "").strip()
        if not line:
            raise ValueError(f"Step3 line parse error at line {line_no}: empty line is not allowed")
        seg_type, speaker, content = _split_step1_prefixed_line(line, line_no)
        text_content = (content or "").strip()
        if not text_content:
            raise ValueError(f"Step3 line parse error at line {line_no}: content is empty")
        emotion_match = _EMOTION_PREFIX_RE.match(text_content)
        emotion = "neutral"
        if emotion_match is not None:
            parsed_emotion = str(emotion_match.group("emotion") or "").lower().strip()
            if parsed_emotion in _EMOTION_VALUES:
                emotion = parsed_emotion
            text_content = text_content[emotion_match.end() :].strip()
        if not text_content:
            raise ValueError(f"Step3 line parse error at line {line_no}: text is empty after emotion prefix")
        non_verbal = _extract_non_verbal_tags_from_text(text_content)
        segments.append(
            Segment(
                id=str(uuid4()),
                index=len(segments),
                type=seg_type,
                speaker=speaker,
                text=text_content,
                emotion=emotion,
                non_verbal=non_verbal,
                tts_overrides={},
            )
        )
    return Script(
        title=title or "未命名剧本",
        source_text=source_text,
        segments=segments,
        characters=_characters_from_segments(segments),
        metadata={"language": "zh", "parser": "verified-five-step-enriched-lines"},
    )


def _build_passthrough_script_from_prefixed_lines(
    lines_text: str,
    *,
    source_text: str,
    title: str = "未命名剧本",
) -> Script:
    lines = (lines_text or "").splitlines()
    segments: list[Segment] = []
    for line_no, original in enumerate(lines, start=1):
        line = (original or "").strip()
        if not line:
            continue
        seg_type, speaker, content = _split_step1_prefixed_line(line, line_no)
        segments.append(
            Segment(
                id=str(uuid4()),
                index=len(segments),
                type=seg_type,
                speaker=speaker,
                text=(content or "").strip(),
                emotion="neutral",
                non_verbal=[],
                tts_overrides={},
            )
        )
    return Script(
        title=title or "未命名剧本",
        source_text=source_text,
        segments=segments,
        characters=_characters_from_segments(segments),
        metadata={"language": "zh", "parser": "verified-five-step-passthrough"},
    )


def _resolve_step3_chunk_chars(llm_options: dict[str, Any] | None) -> int:
    opts = llm_options or {}
    try:
        n_ctx = int(opts.get("n_ctx", 8192) or 8192)
    except Exception:
        n_ctx = 8192
    try:
        max_tokens = int(opts.get("max_tokens", 4096) or 4096)
    except Exception:
        max_tokens = 4096
    if max_tokens <= 2048:
        by_tokens = 1800
    elif max_tokens <= 3072:
        by_tokens = 2200
    elif max_tokens <= 4096:
        by_tokens = 2600
    elif max_tokens <= 6144:
        by_tokens = 3000
    else:
        by_tokens = 3600
    if n_ctx <= 4096:
        return min(by_tokens, 1600)
    if n_ctx <= 8192:
        return by_tokens
    if n_ctx <= 16384:
        return min(int(by_tokens * 1.15), 4200)
    return min(int(by_tokens * 1.3), 4800)


async def run_verified_five_step_parse_pipeline(
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
    parse_step_raw_with_stats: ParseStepRawWithStats,
    step1_script_prompt: str,
    step3_enrich_prompt: str,
    logger: Any,
) -> tuple[Script, dict[str, Any]]:
    started = time.perf_counter()
    opts = llm_options or {}
    custom_prompt_ignored = bool((prompt or "").strip())

    if on_stage is not None:
        await on_stage("step1_script_gen", "Step 1：剧本化解析", 8)

    max_step1_chunk_chars = resolve_chunk_chars(opts)

    async def _parse_step1_chunk(
        chunk_text: str,
        _chunk_prompt: str | None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> tuple[Script, dict[str, Any]]:
        raw_text, raw_stats = await parse_step_raw_with_stats(
            text=chunk_text,
            prompt=None,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=step1_script_prompt,
        )
        _log_verified_step_result(logger, "step1_raw_chunk", raw_text)
        stats = dict(raw_stats or {})
        try:
            draft = parse_step1_lines_to_structured_draft(
                raw_text,
                source_text=chunk_text,
                apply_source_correction=False,
            )
        except Exception as exc:
            logger.warning("Verified five-step Step1 line parse failed, fallback to source-corrected draft: %s", exc)
            stats["fallback"] = True
            stats["error"] = str(exc)
            fallback_draft = _empty_fallback_draft(source_text=chunk_text, title="未命名剧本")
            draft = _build_source_corrected_draft(
                chunk_text,
                title="未命名剧本",
                fallback_draft=fallback_draft,
            )
        script = structured_draft_to_script(draft, source_text=chunk_text)
        stats["step1_line_count"] = len(draft.segments)
        stats["step1_raw_chars"] = len(raw_text or "")
        return script, stats

    step1_script, step1_stats = await run_chunked_parse_flow(
        text=text,
        prompt=None,
        on_chunk=on_chunk,
        on_chunk_progress=on_chunk_progress,
        on_chunk_start=on_chunk_start,
        llm_options=opts,
        max_chunk_chars=max_step1_chunk_chars,
        backend_name=backend_name,
        parse_single_with_stats=_parse_step1_chunk,
        logger=logger,
    )
    _log_verified_step_result(logger, "step1_script", _script_to_prefixed_lines(step1_script))

    if on_stage is not None:
        await on_stage("step2_verify_script", "Step 2：校对 Step1 剧本", 34)

    step2_started = time.perf_counter()
    step2_draft, step2_report = verify_step1_script_with_source(step1_script=step1_script, source_text=text)
    step2_lines_text = draft_to_prefixed_lines(step2_draft)
    _log_verified_step_result(logger, "step2_verified_script", step2_lines_text)
    step2_stats = {
        "duration_ms": int((time.perf_counter() - step2_started) * 1000),
        **step2_report,
    }

    if on_stage is not None:
        await on_stage("step3_enrich", "Step 3：注入 TTS 参数并格式化", 52)

    if backend_name == "mock":
        step3_script = _build_passthrough_script_from_prefixed_lines(
            step2_lines_text,
            source_text=step2_lines_text,
            title=step2_draft.title,
        )
        step3_stats: dict[str, Any] = {
            "mode": "mock_passthrough",
            "backend": "mock",
            "total_chunks": 1,
            "duration_ms": 0,
            "repair_used_count": 0,
            "fallback_count": 0,
            "chunk_stats": [],
        }
    else:
        max_step3_chunk_chars = _resolve_step3_chunk_chars(opts)

        async def _parse_step3_chunk(
            chunk_text: str,
            _chunk_prompt: str | None,
            on_chunk: ChunkCallback | None = None,
            llm_options: dict[str, Any] | None = None,
        ) -> tuple[Script, dict[str, Any]]:
            raw_text, raw_stats = await parse_step_raw_with_stats(
                text=chunk_text,
                prompt=None,
                on_chunk=on_chunk,
                llm_options=llm_options,
                extraction_prompt=step3_enrich_prompt,
            )
            _log_verified_step_result(logger, "step3_raw_chunk", raw_text)
            stats = dict(raw_stats or {})
            try:
                script = parse_step3_enriched_lines_to_script(
                    raw_text,
                    source_text=chunk_text,
                    title=step2_draft.title,
                )
            except Exception as exc:
                logger.warning("Verified five-step Step3 parse failed, fallback to passthrough chunk: %s", exc)
                stats["fallback"] = True
                stats["error"] = str(exc)
                script = _build_passthrough_script_from_prefixed_lines(
                    chunk_text,
                    source_text=chunk_text,
                    title=step2_draft.title,
                )
            stats["step3_line_count"] = len(script.segments)
            stats["step3_raw_chars"] = len(raw_text or "")
            return script, stats

        step3_script, step3_stats = await run_chunked_parse_flow(
            text=step2_lines_text,
            prompt=None,
            on_chunk=on_chunk,
            on_chunk_progress=on_chunk_progress,
            on_chunk_start=on_chunk_start,
            llm_options=opts,
            max_chunk_chars=max_step3_chunk_chars,
            backend_name=backend_name,
            parse_single_with_stats=_parse_step3_chunk,
            logger=logger,
        )
    _log_verified_step_result(logger, "step3_script", _script_to_prefixed_lines(step3_script))

    if on_stage is not None:
        await on_stage("step4_verify_enrich", "Step 4：校对 Enrich 结果", 76)

    step4_started = time.perf_counter()
    step4_guard = analyze_two_step_structure_drift(step2_draft, step3_script)
    merged_script = merge_two_step_output(
        structure_draft=step2_draft,
        tts_script=step3_script,
        source_text=text,
        structure_guard=step4_guard,
    )
    _log_verified_step_result(logger, "step4_merged_script", _script_to_prefixed_lines(merged_script))
    step4_coverage = _scan_source_coverage(source_text=text, segments=merged_script.segments)
    step4_stats = {
        "duration_ms": int((time.perf_counter() - step4_started) * 1000),
        "structure_guard": step4_guard,
        "segment_count_after_merge": len(merged_script.segments),
        **step4_coverage,
    }

    if on_stage is not None:
        await on_stage("step5_json_build", "Step 5：逐行转换为 JSON 片段", 92)

    step5_started = time.perf_counter()
    metadata = dict(merged_script.metadata or {})
    metadata["parse_pipeline"] = "verified_five_step"
    metadata["parse_mode"] = "verified_five_step_pipeline"
    if not metadata.get("parser"):
        metadata["parser"] = f"{backend_name}-verified-five-step"
    final_characters = merged_script.characters or _characters_from_segments(merged_script.segments)
    final_script = Script(
        title=merged_script.title or step2_draft.title or "未命名剧本",
        source_text=text,
        segments=[
            segment.model_copy(update={"id": str(segment.id), "index": int(segment.index)})
            for segment in merged_script.segments
        ],
        characters=final_characters,
        metadata=metadata,
    )
    _log_verified_step_result(
        logger,
        "step5_final_json",
        json.dumps(final_script.model_dump(mode="json"), ensure_ascii=False, indent=2),
    )
    step5_stats = {
        "duration_ms": int((time.perf_counter() - step5_started) * 1000),
        "segment_count": len(final_script.segments),
        "character_count": len(final_script.characters),
    }

    if on_stage is not None:
        await on_stage("finalizing", "正在整理最终解析结果", 98)

    total_duration_ms = int((time.perf_counter() - started) * 1000)
    repair_used_count = int(step1_stats.get("repair_used_count", 0)) + int(step3_stats.get("repair_used_count", 0))
    fallback_count = int(step1_stats.get("fallback_count", 0)) + int(step3_stats.get("fallback_count", 0))
    parse_stats = {
        "mode": "verified_five_step",
        "backend": backend_name,
        "total_chunks": int(step1_stats.get("total_chunks", 1)) + int(step3_stats.get("total_chunks", 1)),
        "duration_ms": total_duration_ms,
        "repair_used_count": repair_used_count,
        "fallback_count": fallback_count,
        "custom_prompt_ignored": custom_prompt_ignored,
        "step_stats": {
            "step1_script_gen": step1_stats,
            "step2_verify_script": step2_stats,
            "step3_enrich": step3_stats,
            "step4_verify_enrich": step4_stats,
            "step5_json_build": step5_stats,
        },
    }
    logger.info(
        "LLM parse completed mode=verified_five_step backend=%s duration_ms=%s repair_count=%s fallback_count=%s",
        backend_name,
        total_duration_ms,
        repair_used_count,
        fallback_count,
    )
    return final_script, parse_stats
