from __future__ import annotations

from collections import Counter
from uuid import uuid4

from backend.models import Character, Script


def merge_chunk_scripts(source_text: str, scripts: list[Script], parser_name: str = "llama-cpp-python-chunked") -> Script:
    segments = []
    speakers: Counter[str] = Counter()
    descriptions: dict[str, str] = {}
    title = "未命名剧本"
    language = "zh"

    for script in scripts:
        if script.title and script.title != "未命名剧本":
            title = script.title
        if script.metadata.get("language"):
            language = str(script.metadata["language"])
        for character in script.characters:
            if character.name and character.description and character.name not in descriptions:
                descriptions[character.name] = character.description
        for segment in script.segments:
            seg = segment.model_copy(update={"id": str(uuid4()), "index": len(segments)})
            segments.append(seg)
            if seg.speaker:
                speakers[seg.speaker] += 1

    characters = [
        Character(
            name=name,
            appearance_count=count,
            description=descriptions.get(name, f"{name} 的角色档案"),
        )
        for name, count in speakers.items()
    ]

    return Script(
        title=title,
        source_text=source_text,
        segments=segments,
        characters=characters,
        metadata={"language": language, "parser": parser_name},
    )
