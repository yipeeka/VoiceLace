from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class TextChunk:
    chunk_index: int
    total_chunks: int
    start_offset: int
    end_offset: int
    text: str


def chunk_text_by_paragraph(text: str, max_chunk_chars: int = 2000) -> list[TextChunk]:
    source = (text or "").strip()
    if not source:
        return []

    paragraphs = [p for p in source.splitlines() if p.strip()]
    blocks: list[str] = []
    cur = ""
    for para in paragraphs:
        candidate = f"{cur}\n{para}".strip() if cur else para
        if len(candidate) <= max_chunk_chars:
            cur = candidate
            continue
        if cur:
            blocks.append(cur)
        if len(para) <= max_chunk_chars:
            cur = para
            continue
        start = 0
        while start < len(para):
            blocks.append(para[start : start + max_chunk_chars].strip())
            start += max_chunk_chars
        cur = ""
    if cur:
        blocks.append(cur)

    chunks: list[TextChunk] = []
    cursor = 0
    total = len(blocks)
    for index, block in enumerate(blocks):
        start = source.find(block, cursor)
        if start < 0:
            start = cursor
        end = start + len(block)
        chunks.append(
            TextChunk(
                chunk_index=index,
                total_chunks=total,
                start_offset=start,
                end_offset=end,
                text=block,
            )
        )
        cursor = end
    return chunks
