from __future__ import annotations

import json
import re
import time
from typing import Any, Awaitable, Callable

from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.models import Character, Script, Segment, StructuredCharacterDraft, StructuredScriptDraft, StructuredSegmentDraft

ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]
StageCallback = Callable[[str, str, int], Awaitable[None]]
ResolveChunkChars = Callable[[dict[str, Any]], int]
ParseSingleWithProfile = Callable[
    ...,
    Awaitable[tuple[Script, dict[str, Any]]],
]


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
    parse_single_with_profile: ParseSingleWithProfile,
    structure_extraction_prompt: str,
    structure_schema: dict[str, Any],
    tts_extraction_prompt: str,
    tts_schema: dict[str, Any],
    logger: Any,
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
        return await parse_single_with_profile(
            text=chunk_text,
            prompt=chunk_prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=structure_extraction_prompt,
            schema=structure_schema,
        )

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
        step2_input = build_step2_input_payload(structure_draft)
        step2_script, step2_stats = await parse_single_with_profile(
            text=json.dumps(step2_input, ensure_ascii=False),
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=tts_extraction_prompt,
            schema=tts_schema,
        )

    structure_guard = analyze_two_step_structure_drift(structure_draft, step2_script)
    step2_stats["structure_guard"] = structure_guard
    if structure_guard["segment_count_changed"] or structure_guard["mismatch_count"] > 0:
        logger.warning(
            "Two-step structure drift detected: count_changed=%s mismatch_count=%s mismatched_indices=%s. "
            "Using Step1 structure as source of truth.",
            structure_guard["segment_count_changed"],
            structure_guard["mismatch_count"],
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
    existing = set(re.findall(r"\[([^\[\]]+)\]", base_text))
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


def build_step2_input_payload(structure_draft: StructuredScriptDraft) -> dict[str, Any]:
    return {
        "title": structure_draft.title,
        "source_text": structure_draft.source_text,
        "segments": [segment.model_dump(mode="json") for segment in structure_draft.segments],
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


def analyze_two_step_structure_drift(structure_draft: StructuredScriptDraft, tts_script: Script) -> dict[str, Any]:
    expected_count = len(structure_draft.segments)
    actual_count = len(tts_script.segments)
    mismatched_indices: list[int] = []
    compare_count = min(expected_count, actual_count)
    for idx in range(compare_count):
        draft_segment = structure_draft.segments[idx]
        parsed = tts_script.segments[idx]
        if (
            draft_segment.type != parsed.type
            or draft_segment.speaker.strip() != parsed.speaker.strip()
            or draft_segment.text.strip() != parsed.text.strip()
        ):
            mismatched_indices.append(idx)
    return {
        "segment_count_expected": expected_count,
        "segment_count_actual": actual_count,
        "segment_count_changed": expected_count != actual_count,
        "mismatched_indices": mismatched_indices,
        "mismatch_count": len(mismatched_indices),
    }


def merge_two_step_output(
    *,
    structure_draft: StructuredScriptDraft,
    tts_script: Script,
    source_text: str,
    structure_guard: dict[str, Any] | None = None,
) -> Script:
    merged_segments: list[Segment] = []
    allow_step2_segment_injection = not bool((structure_guard or {}).get("segment_count_changed", False))
    for idx, draft_segment in enumerate(structure_draft.segments):
        enriched = tts_script.segments[idx] if allow_step2_segment_injection and idx < len(tts_script.segments) else None
        non_verbal_items = [str(item) for item in ((enriched.non_verbal if enriched is not None else []) or [])]
        merged_text = apply_non_verbal_tags_to_text(draft_segment.text, non_verbal_items)
        merged_segments.append(
            Segment(
                id=str(draft_segment.id),
                index=draft_segment.index,
                type=draft_segment.type,
                speaker=draft_segment.speaker,
                text=merged_text,
                emotion=((enriched.emotion if enriched is not None else "neutral") or "neutral").strip() or "neutral",
                non_verbal=non_verbal_items,
                tts_overrides=dict((enriched.tts_overrides if enriched is not None else {}) or {}),
            )
        )
    metadata = dict(structure_draft.metadata or {})
    metadata.update(dict(tts_script.metadata or {}))
    metadata["parse_pipeline"] = "two_step"
    final_characters = (tts_script.characters if allow_step2_segment_injection else []) or [
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
