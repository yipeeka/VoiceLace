from __future__ import annotations

import json


_BPM_OPTIONS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180]
_KEYSCALE_OPTIONS = [
    "C major",
    "G major",
    "D major",
    "A major",
    "E major",
    "B major",
    "F# major",
    "F major",
    "Bb major",
    "Eb major",
    "Ab major",
    "A minor",
    "E minor",
    "B minor",
    "F# minor",
    "C# minor",
    "G# minor",
    "D minor",
    "G minor",
    "C minor",
    "F minor",
]
_TIMESIGNATURE_OPTIONS = ["4/4", "3/4", "2/4", "6/8", "12/8", "5/4", "7/8"]
_LANG_OPTIONS = ["unknown", "zh", "en", "ja", "ko"]


def build_music_assist_chat_prompt(*, current_form: dict, project_context: str = "") -> str:
    project_block = ""
    if (project_context or "").strip():
        project_block = f"\n\n项目文本上下文（可用于提炼主题与情绪）：\n{project_context.strip()}"
    return (
        "你是专业音乐制作助手。你的目标是帮助用户逐步明确音乐生成需求。"
        "请像制作人一样对话，先理解用途、风格、情绪、乐器、人声、结构，再给建议。"
        "不要输出 JSON。"
        "\n\n"
        "请遵循 ACE-Step 的输入分工："
        "\n"
        "1) prompt: 描述整体音乐画像（风格、音色、编曲、情绪、人声与结构）；"
        "\n"
        "2) lyrics: 描述歌词/段落脚本，支持 [Intro] [Verse] [Chorus] 等段落标签；"
        "\n"
        "3) bpm/keyscale/timesignature/vocal_language/audio_duration: 作为独立参数。"
        "\n\n"
        "你需要主动补齐缺失信息，但不要强制一次问完全部问题。"
        "当信息足够时，可提醒用户点击“生成并填入”。"
        "\n\n"
        f"当前页面表单快照：\n{json.dumps(current_form, ensure_ascii=False)}"
        f"{project_block}"
        "\n\n"
        "回复要求：简洁、可执行、与用户输入语言保持一致。"
    )


def build_music_assist_finalize_prompt(*, current_form: dict, project_context: str = "") -> str:
    project_block = ""
    if (project_context or "").strip():
        project_block = f"\n\n项目文本上下文（可用于提炼主题与情绪）：\n{project_context.strip()}"
    return (
        "你是 ACE-Step 音乐生成参数整理器。"
        "请根据对话内容生成最终可填入表单的结构化结果。"
        "必须只输出一个 JSON 对象，不要输出任何解释、不要代码块。"
        "\n\n"
        "字段要求："
        "\n"
        "prompt: string，必填。用于描述音乐画像，不要把 bpm/keyscale/timesignature 写进这里。"
        "\n"
        "lyrics: string，选填。纯音乐请输出 \"[Instrumental]\"。"
        "\n"
        "audio_duration: number，范围 1-120。"
        "\n"
        "vocal_language: string，必须是 unknown/zh/en/ja/ko 之一。"
        "\n"
        "bpm: number|null，只能从允许值中选择。"
        "\n"
        "keyscale: string|null，只能从允许值中选择。"
        "\n"
        "timesignature: string|null，只能从允许值中选择。"
        "\n"
        "notes: string，可选，给用户的简短说明。"
        "\n"
        "warnings: string[]，可选。"
        "\n\n"
        "可选值约束："
        "\n"
        f"bpm: {_BPM_OPTIONS}"
        "\n"
        f"keyscale: {_KEYSCALE_OPTIONS}"
        "\n"
        f"timesignature: {_TIMESIGNATURE_OPTIONS}"
        "\n"
        f"vocal_language: {_LANG_OPTIONS}"
        "\n\n"
        f"当前页面表单快照：\n{json.dumps(current_form, ensure_ascii=False)}"
        f"{project_block}"
        "\n\n"
        "输出示例（仅结构示意）："
        "\n"
        "{\"prompt\":\"...\",\"lyrics\":\"...\",\"audio_duration\":30,\"vocal_language\":\"en\","
        "\"bpm\":120,\"keyscale\":\"C major\",\"timesignature\":\"4/4\",\"notes\":\"...\",\"warnings\":[]}"
    )
