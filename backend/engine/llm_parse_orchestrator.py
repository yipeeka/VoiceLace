from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from backend.engine.chunk_merger import merge_chunk_scripts
from backend.engine.text_chunker import chunk_text_by_paragraph
from backend.models import Script

ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]
ParseSingleWithStats = Callable[
    [str, str | None, ChunkCallback | None, dict[str, Any] | None],
    Awaitable[tuple[Script, dict[str, Any]]],
]


async def run_chunked_parse_flow(
    *,
    text: str,
    prompt: str | None,
    on_chunk: ChunkCallback | None,
    on_chunk_progress: ChunkProgressCallback | None,
    on_chunk_start: ChunkProgressCallback | None,
    llm_options: dict[str, Any] | None,
    max_chunk_chars: int,
    backend_name: str,
    parse_single_with_stats: ParseSingleWithStats,
    logger: Any,
) -> tuple[Script, dict[str, Any]]:
    started = time.perf_counter()
    chunks = chunk_text_by_paragraph(text, max_chunk_chars=max_chunk_chars)

    if len(chunks) <= 1:
        script, stats = await parse_single_with_stats(
            text,
            prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        parse_stats = {
            "mode": "single",
            "backend": backend_name,
            "total_chunks": 1,
            "duration_ms": elapsed_ms,
            "repair_used_count": 1 if stats.get("repair_used") else 0,
            "fallback_count": 1 if stats.get("fallback") else 0,
            "chunk_stats": [stats],
        }
        logger.info(
            "LLM parse completed mode=single backend=%s duration_ms=%s attempts=%s repair=%s fallback=%s",
            backend_name,
            elapsed_ms,
            stats.get("attempts", 1),
            stats.get("repair_used", False),
            stats.get("fallback", False),
        )
        return script, parse_stats

    known_characters: dict[str, str] = {}
    scripts: list[Script] = []
    chunk_stats: list[dict[str, Any]] = []
    total = len(chunks)
    for index, chunk in enumerate(chunks, start=1):
        if on_chunk_start is not None:
            await on_chunk_start(index, total)
        context_lines = [
            f"- {name}: {desc}"
            for name, desc in known_characters.items()
            if name and desc
        ]
        context_text = "\n".join(context_lines)
        chunk_prompt = prompt or ""
        if context_text:
            chunk_prompt = f"{chunk_prompt}\n\n已知角色：\n{context_text}".strip()
        script, stats = await parse_single_with_stats(
            chunk.text,
            chunk_prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
        )
        stats["chunk_index"] = index
        stats["total_chunks"] = total
        chunk_stats.append(stats)
        scripts.append(script)
        for char in script.characters:
            if char.name and char.description and char.name not in known_characters:
                known_characters[char.name] = char.description
        if on_chunk_progress is not None:
            await on_chunk_progress(index, total)

    merged = merge_chunk_scripts(text, scripts)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    repair_used_count = sum(1 for item in chunk_stats if item.get("repair_used"))
    fallback_count = sum(1 for item in chunk_stats if item.get("fallback"))
    parse_stats = {
        "mode": "chunked",
        "backend": backend_name,
        "total_chunks": total,
        "duration_ms": elapsed_ms,
        "repair_used_count": repair_used_count,
        "fallback_count": fallback_count,
        "chunk_stats": chunk_stats,
    }
    logger.info(
        "LLM parse completed mode=chunked backend=%s chunks=%s duration_ms=%s repair_count=%s fallback_count=%s",
        backend_name,
        total,
        elapsed_ms,
        repair_used_count,
        fallback_count,
    )
    return merged, parse_stats
