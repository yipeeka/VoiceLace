from __future__ import annotations

import json
import math
import re
import struct
import wave
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from backend.models import Project, VoicePreset, VoiceQualityIssue, VoiceQualityReport

_TOKEN_PATTERN = re.compile(r"[a-z0-9\u4e00-\u9fff]{2,}", re.IGNORECASE)
_WORD_SPLIT_PATTERN = re.compile(r"[^a-z0-9\u4e00-\u9fff]+", re.IGNORECASE)
_JSON_BLOCK_PATTERN = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.IGNORECASE | re.DOTALL)
_SOURCE_SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[。！？!?；;])\s*|\n+")
_RECOMMEND_KEYWORDS = {
    "male": ["男", "男性", "男声", "大叔", "老者", "爷爷", "叔叔", "书生", "差役", "male"],
    "female": ["女", "女性", "女声", "少女", "御姐", "女士", "姐姐", "妈妈", "female"],
    "child": ["童子", "孩童", "孩子", "小孩", "儿童", "少年", "child", "cartoon"],
    "old": ["老", "年长", "年迈", "老人", "长者", "elderly"],
    "young": ["年轻", "青年", "少年", "少女", "小伙", "小姑娘", "young"],
    "narrator": ["旁白", "narrator", "narration", "讲述", "叙述", "news", "novel"],
    "calm": ["平静", "冷静", "稳重", "克制", "低调", "calm", "reliable", "professional"],
    "lively": ["活泼", "欢快", "俏皮", "轻快", "灵动", "lively", "sunshine", "positive"],
    "dramatic": ["戏剧", "夸张", "高张力", "冲突", "激动", "dramatic", "passion"],
    "gentle": ["温柔", "柔和", "亲切", "细腻", "gentle", "friendly", "warm"],
    "whisper": ["低语", "耳语", "悄声", "轻声", "whisper"],
}

_ROLE_TRAITS = {
    "narrator": ["旁白", "narrator", "narration", "讲述", "叙述", "稳重", "calm", "news", "novel"],
    "旁白": ["旁白", "narrator", "narration", "讲述", "叙述", "稳重", "calm", "news", "novel"],
    "老": ["男性", "男声", "年长", "稳重", "old", "male", "reliable", "professional"],
    "父": ["男性", "男声", "年长", "稳重", "old", "male", "reliable"],
    "爹": ["男性", "男声", "年长", "稳重", "old", "male", "reliable"],
    "儿子": ["男孩", "少年", "年轻", "young", "child", "male"],
    "童": ["儿童", "孩童", "少年", "child", "cartoon", "lively"],
    "孩": ["儿童", "孩童", "少年", "child", "cartoon", "lively"],
    "差役": ["男性", "男声", "威严", "坚定", "male", "assertive", "professional"],
    "兵": ["男性", "男声", "威严", "坚定", "male", "assertive", "professional"],
    "汉子": ["男性", "男声", "粗犷", "市井", "male", "lively"],
    "男人": ["男性", "男声", "male"],
    "妇": ["女性", "女声", "成熟女性", "female", "middle", "warm"],
    "娘": ["女性", "女声", "成熟女性", "female", "middle", "warm"],
    "女": ["女性", "女声", "female"],
    "茶客": ["男性", "男声", "市井", "叙事", "male", "novel"],
}


def _safe_db_value(value: float | int | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    if numeric == float("inf") or numeric == float("-inf"):
        return None
    return round(numeric, 3)


def _is_placeholder_character_description(name: str, description: str) -> bool:
    value = (description or "").strip()
    if not value:
        return False
    normalized = re.sub(r"\s+", "", value)
    normalized_name = re.sub(r"\s+", "", name or "")
    placeholders = {
        f"{normalized_name}的角色档案",
        f"{normalized_name}角色档案",
        "角色档案",
    }
    return normalized in placeholders or normalized.endswith("的角色档案")


def _infer_character_traits(name: str) -> str:
    normalized = (name or "").strip()
    traits: list[str] = []
    for key, values in _ROLE_TRAITS.items():
        if key == normalized or (key not in {"narrator", "旁白"} and key in normalized):
            traits.extend(values)
    return " ".join(normalize_tags(traits))


def _build_source_contexts(source_text: str, names: set[str], max_sentences: int = 5) -> dict[str, str]:
    contexts = {name: [] for name in names}
    text = (source_text or "").strip()
    if not text or not names:
        return {name: "" for name in names}

    sentences = [item.strip() for item in _SOURCE_SENTENCE_SPLIT_PATTERN.split(text) if item.strip()]
    for sentence in sentences:
        for name in names:
            if not name or name == "narrator":
                continue
            if name in sentence and len(contexts[name]) < max_sentences:
                contexts[name].append(sentence)
    if "narrator" in contexts and not contexts["narrator"]:
        contexts["narrator"] = sentences[:max_sentences]
    return {name: " ".join(items) for name, items in contexts.items()}


def _analyze_wav_audio(audio_path: Path, report: VoiceQualityReport) -> bool:
    try:
        with wave.open(str(audio_path), "rb") as wav_file:
            frame_rate = int(wav_file.getframerate() or 0)
            frame_count = int(wav_file.getnframes() or 0)
            channels = int(wav_file.getnchannels() or 0)
            sample_width = int(wav_file.getsampwidth() or 0)
            raw_frames = wav_file.readframes(frame_count)
    except Exception:
        return False

    report.sample_rate = frame_rate
    report.channels = channels
    report.sample_width = sample_width
    report.duration_sec = round(frame_count / frame_rate, 3) if frame_rate else 0.0
    if not raw_frames or sample_width <= 0:
        return True

    max_possible = float((1 << (8 * sample_width - 1)) - 1)
    sample_count = len(raw_frames) // sample_width
    if sample_count <= 0 or max_possible <= 0:
        return True

    abs_values: list[float] = []
    clipping_count = 0
    silent_count = 0
    silence_threshold = max_possible * 0.02
    for offset in range(0, len(raw_frames), sample_width):
        chunk = raw_frames[offset : offset + sample_width]
        if len(chunk) < sample_width:
            break
        if sample_width == 1:
            value = float(abs(chunk[0] - 128))
        elif sample_width == 2:
            value = float(abs(struct.unpack("<h", chunk)[0]))
        else:
            # 24-bit / 32-bit fallback
            int_value = int.from_bytes(chunk, byteorder="little", signed=True)
            value = float(abs(int_value))
        abs_values.append(value)
        if value <= silence_threshold:
            silent_count += 1
        if value >= max_possible * 0.995:
            clipping_count += 1

    if not abs_values:
        return True
    mean_abs = sum(abs_values) / len(abs_values)
    peak_abs = max(abs_values)
    # Approximate full-scale dB metrics from PCM amplitude.
    if mean_abs > 0:
        report.loudness_dbfs = round(20.0 * math.log10(mean_abs / max_possible), 3)
    if peak_abs > 0:
        report.peak_dbfs = round(20.0 * math.log10(peak_abs / max_possible), 3)
    report.silence_ratio = round(min(1.0, silent_count / len(abs_values)), 4)
    report.clipping_ratio = round(clipping_count / len(abs_values), 6)
    return True


def analyze_reference_audio(audio_path: Path) -> VoiceQualityReport:
    report = VoiceQualityReport(checked_at=datetime.now(timezone.utc).isoformat())
    if not audio_path.exists() or not audio_path.is_file():
        report.status = "fail"
        report.score = 0
        report.issues.append(VoiceQualityIssue(code="file_missing", severity="fail", message="参考音频不存在或不可读取"))
        return report

    suffix = audio_path.suffix.lower().strip()
    parsed = False
    if suffix == ".wav":
        parsed = _analyze_wav_audio(audio_path, report)
    if not parsed:
        try:
            from pydub import AudioSegment

            audio = AudioSegment.from_file(str(audio_path))
            report.duration_sec = round(len(audio) / 1000.0, 3)
            report.sample_rate = int(audio.frame_rate or 0)
            report.channels = int(audio.channels or 0)
            report.sample_width = int(audio.sample_width or 0)
            report.loudness_dbfs = _safe_db_value(audio.dBFS)
            report.peak_dbfs = _safe_db_value(audio.max_dBFS)

            if len(audio):
                from pydub.silence import detect_silence

                silence_ranges = detect_silence(audio, min_silence_len=200, silence_thresh=-45)
                silence_total_ms = sum(max(0, end - start) for start, end in silence_ranges)
                report.silence_ratio = round(min(1.0, silence_total_ms / len(audio)), 4)

            samples = audio.get_array_of_samples()
            if samples:
                max_possible = float((1 << (8 * max(1, report.sample_width) - 1)) - 1)
                clipping_count = sum(1 for sample in samples if abs(sample) >= max_possible * 0.995)
                report.clipping_ratio = round(clipping_count / float(len(samples)), 6)
        except Exception:
            report.status = "fail"
            report.score = 0
            report.issues.append(VoiceQualityIssue(code="decode_failed", severity="fail", message="参考音频无法解析，请更换为 WAV/MP3/FLAC"))
            return report

    issues: list[VoiceQualityIssue] = []

    if report.duration_sec <= 0:
        issues.append(VoiceQualityIssue(code="empty_audio", severity="fail", message="音频时长为 0 秒"))
    elif report.duration_sec < 1.0:
        issues.append(VoiceQualityIssue(code="too_short", severity="warning", message="音频时长偏短，建议至少 1 秒"))
    elif report.duration_sec > 45.0:
        issues.append(VoiceQualityIssue(code="too_long", severity="warning", message="音频较长，建议控制在 3~30 秒"))

    if report.sample_rate and report.sample_rate < 16000:
        issues.append(VoiceQualityIssue(code="sample_rate_low", severity="warning", message="采样率偏低，建议至少 16kHz"))

    if report.channels and report.channels > 2:
        issues.append(VoiceQualityIssue(code="channels_many", severity="warning", message="声道数过多，建议单声道或双声道"))

    if report.loudness_dbfs is not None and report.loudness_dbfs < -35:
        issues.append(VoiceQualityIssue(code="too_quiet", severity="warning", message="音量偏低，建议提高录音响度"))

    if report.peak_dbfs is not None and report.peak_dbfs > -0.6:
        issues.append(VoiceQualityIssue(code="peak_hot", severity="warning", message="峰值过高，存在失真风险"))

    if report.silence_ratio > 0.55:
        issues.append(VoiceQualityIssue(code="silence_high", severity="warning", message="静音占比偏高，建议裁掉长静音"))

    if report.clipping_ratio > 0.02:
        issues.append(VoiceQualityIssue(code="clipping_high", severity="fail", message="削波严重，建议重录参考音频"))
    elif report.clipping_ratio > 0.005:
        issues.append(VoiceQualityIssue(code="clipping_risk", severity="warning", message="存在削波风险，建议降低录音增益"))

    fail_count = sum(1 for issue in issues if issue.severity == "fail")
    warning_count = sum(1 for issue in issues if issue.severity == "warning")
    score = max(0, 100 - fail_count * 40 - warning_count * 10)

    report.issues = issues
    report.score = int(score)
    if fail_count:
        report.status = "fail"
    elif warning_count:
        report.status = "warning"
    else:
        report.status = "pass"
    return report


def normalize_tags(raw_tags: list[str] | None) -> list[str]:
    if not raw_tags:
        return []
    dedup: list[str] = []
    seen: set[str] = set()
    for tag in raw_tags:
        value = (tag or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        dedup.append(value)
    return dedup


def _tokenize(text: str) -> set[str]:
    lowered = (text or "").strip().lower()
    if not lowered:
        return set()
    return {token for token in _TOKEN_PATTERN.findall(lowered) if len(token) >= 2}


def _build_character_rows(project: Project) -> list[dict]:
    character_map: dict[str, dict] = {}
    segment_group: dict[str, list[str]] = defaultdict(list)
    for segment in project.script.segments:
        speaker = (segment.speaker or "").strip() or "narrator"
        if speaker not in character_map:
            character_map[speaker] = {"name": speaker, "description": "", "appearance_count": 0}
        character_map[speaker]["appearance_count"] = int(character_map[speaker]["appearance_count"] or 0) + 1
        if len(segment_group[speaker]) < 8 and (segment.text or "").strip():
            segment_group[speaker].append(segment.text.strip())

    for character in project.script.characters:
        name = (character.name or "").strip()
        if not name:
            continue
        if name not in character_map:
            character_map[name] = {"name": name, "description": "", "appearance_count": 0}
        current_description = (character_map[name].get("description") or "").strip()
        if not current_description:
            raw_description = (character.description or "").strip()
            character_map[name]["description"] = "" if _is_placeholder_character_description(name, raw_description) else raw_description
        character_map[name]["appearance_count"] = max(
            int(character_map[name]["appearance_count"] or 0),
            int(character.appearance_count or 0),
        )

    source_contexts = _build_source_contexts(project.script.source_text, set(character_map.keys()))
    rows: list[dict] = []
    for name, row in character_map.items():
        rows.append(
            {
                "name": name,
                "description": row.get("description", ""),
                "appearance_count": int(row.get("appearance_count", 0) or 0),
                "sample_text": " ".join(segment_group.get(name, [])),
                "source_context": source_contexts.get(name, ""),
                "role_traits": _infer_character_traits(name),
            }
        )
    rows.sort(key=lambda item: item.get("appearance_count", 0), reverse=True)
    return rows


def _build_preset_search_text(preset: VoicePreset, backend: str) -> str:
    omni = preset.resolved_omnivoice_profile()
    vox = preset.resolved_voxcpm2_profile()
    chunks = [
        preset.name,
        preset.description,
        preset.suitable_role_description,
        " ".join(preset.tags),
        preset.gender or "",
        preset.age or "",
        preset.pitch or "",
        preset.style or "",
        preset.accent or "",
        preset.dialect or "",
        preset.custom_instruct or "",
    ]
    if backend == "omnivoice":
        chunks.extend([omni.custom_instruct or "", omni.accent or "", omni.dialect or "", omni.style or ""])
    else:
        chunks.extend([vox.design_instruction or "", vox.control_instruction or ""])
    return " ".join(chunk for chunk in chunks if chunk).strip()


def _build_keyword_boost(character_text: str, preset_text: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    lowered_character = character_text.lower()
    lowered_preset = preset_text.lower()
    for label, keywords in _RECOMMEND_KEYWORDS.items():
        has_character_signal = any(keyword in lowered_character for keyword in keywords)
        if not has_character_signal:
            continue
        matched = [keyword for keyword in keywords if keyword in lowered_preset]
        if matched:
            score += 10
            reasons.append(f"匹配{label}特征：{matched[0]}")
    return score, reasons


def recommend_presets_for_project(project: Project, presets: list[VoicePreset], backend: str, limit: int = 3) -> dict:
    target_backend = (backend or "omnivoice").strip().lower()
    if target_backend not in {"omnivoice", "voxcpm2"}:
        target_backend = "omnivoice"
    top_k = max(1, min(10, int(limit or 3)))

    characters = _build_character_rows(project)
    results: list[dict] = []

    for character in characters:
        description = character.get("description", "")
        character_text = " ".join(
            chunk
            for chunk in [
                character.get("name", ""),
                description,
                character.get("sample_text", ""),
                character.get("source_context", ""),
                character.get("role_traits", ""),
            ]
            if chunk
        )
        character_tokens = _tokenize(character_text)
        candidates: list[dict] = []

        for preset in presets:
            preset_text = _build_preset_search_text(preset, target_backend)
            preset_tokens = _tokenize(preset_text)
            overlap = character_tokens.intersection(preset_tokens)

            score = 0
            reasons: list[str] = []
            if overlap:
                score += min(40, len(overlap) * 8)
                overlap_preview = sorted(list(overlap))[:4]
                reasons.append(f"词项匹配：{', '.join(overlap_preview)}")

            if preset.favorite and score > 0:
                score += 4
                reasons.append("收藏预设加权")

            tag_matches = []
            for tag in preset.tags:
                if tag and tag.lower() in character_text.lower():
                    tag_matches.append(tag)
            if tag_matches:
                score += min(20, len(tag_matches) * 6)
                reasons.append(f"标签命中：{', '.join(tag_matches[:3])}")

            keyword_boost, keyword_reasons = _build_keyword_boost(character_text, preset_text)
            if keyword_boost:
                score += keyword_boost
                reasons.extend(keyword_reasons[:2])

            quality = preset.quality_reports.get(target_backend)
            quality_status = quality.status if quality else "unknown"
            if quality_status == "warning":
                score -= 6
                reasons.append("参考音频质量：warning")
            elif quality_status == "fail":
                score -= 15
                reasons.append("参考音频质量：fail")

            normalized_score = max(0, min(100, int(score)))
            if normalized_score > 0:
                candidates.append(
                    {
                        "preset_id": preset.id,
                        "name": preset.name,
                        "score": normalized_score,
                        "favorite": bool(preset.favorite),
                        "tags": preset.tags,
                        "quality_status": quality_status,
                        "reasons": reasons[:3] if reasons else ["内容匹配"],
                    }
                )

        candidates.sort(key=lambda item: (item["score"], int(item["favorite"])), reverse=True)
        results.append(
            {
                "character": character.get("name", ""),
                "description": character.get("description", ""),
                "appearance_count": character.get("appearance_count", 0),
                "top": candidates[:top_k],
                "source_context": character.get("source_context", ""),
            }
        )

    return {
        "project_id": project.id,
        "backend": target_backend,
        "limit": top_k,
        "recommendations": results,
    }


def build_content_recommendation_payload(project: Project, presets: list[VoicePreset], backend: str, limit: int = 3) -> dict:
    target_backend = (backend or "omnivoice").strip().lower()
    if target_backend not in {"omnivoice", "voxcpm2"}:
        target_backend = "omnivoice"
    top_k = max(1, min(10, int(limit or 3)))
    characters = _build_character_rows(project)
    payload_characters: list[dict] = []
    for character in characters:
        payload_characters.append(
            {
                "name": character.get("name", ""),
                "description": character.get("description", ""),
                "appearance_count": int(character.get("appearance_count", 0) or 0),
                "sample_text": character.get("sample_text", ""),
                "source_context": character.get("source_context", ""),
                "role_traits": character.get("role_traits", ""),
            }
        )

    payload_presets: list[dict] = []
    for preset in presets:
        quality = preset.quality_reports.get(target_backend)
        quality_status = quality.status if quality else "unknown"
        omni = preset.resolved_omnivoice_profile()
        vox = preset.resolved_voxcpm2_profile()
        backend_hint = (
            {
                "voice_mode": omni.voice_mode,
                "style": omni.style or "",
                "custom_instruct": omni.custom_instruct or "",
            }
            if target_backend == "omnivoice"
            else {
                "voice_mode": vox.voice_mode,
                "design_instruction": vox.design_instruction or "",
                "control_instruction": vox.control_instruction or "",
            }
        )
        payload_presets.append(
            {
                "id": preset.id,
                "name": preset.name,
                "tags": preset.tags,
                "description": preset.description,
                "suitable_role_description": preset.suitable_role_description,
                "favorite": bool(preset.favorite),
                "quality_status": quality_status,
                "backend_hint": backend_hint,
            }
        )

    return {
        "project_id": project.id,
        "backend": target_backend,
        "limit": top_k,
        "characters": payload_characters,
        "presets": payload_presets,
    }


def content_recommendation_prompt(limit: int) -> str:
    top_k = max(1, min(10, int(limit or 3)))
    return (
        "你是中文配音导演。根据角色内容样本与预设信息，为每个角色推荐最匹配的声音预设。"
        "重点看角色台词、原文上下文、旁白内容、语气与情绪；角色描述如果为空或类似“某某的角色档案”，必须忽略。"
        "角色名只作为年龄/性别/身份的辅助线索，不能覆盖内容样本。"
        "仅输出 JSON，不要输出任何解释文字。"
        '\nJSON 格式必须是：{"recommendations":[{"character":"角色名","top":[{"preset_id":"预设ID","score":0-100,"reasons":["简短理由"]}]}]}。'
        f"\n每个角色 top 数量不超过 {top_k}，reasons 最多 2 条。"
        "\nscore 需为整数，分数越高越匹配。"
    )


def parse_content_recommendations(
    raw_text: str,
    *,
    characters: list[dict],
    preset_ids: set[str],
    limit: int,
) -> tuple[list[dict], list[str]]:
    top_k = max(1, min(10, int(limit or 3)))
    warnings: list[str] = []
    parsed: dict = {}

    content = (raw_text or "").strip()
    if not content:
        return [], ["LLM 返回空内容"]

    try:
        parsed = json.loads(content)
    except Exception:
        match = _JSON_BLOCK_PATTERN.search(content)
        if match:
            try:
                parsed = json.loads(match.group(1))
            except Exception:
                parsed = {}
        else:
            parsed = {}
    if not isinstance(parsed, dict):
        return [], ["LLM 返回格式不是 JSON 对象"]

    rows = parsed.get("recommendations")
    if not isinstance(rows, list):
        return [], ["LLM 返回缺少 recommendations 列表"]

    by_character: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("character", "")).strip()
        if not name or name in by_character:
            continue
        by_character[name] = row

    normalized_rows: list[dict] = []
    for character in characters:
        name = str(character.get("name", "")).strip()
        source = by_character.get(name, {})
        top_items = source.get("top", []) if isinstance(source, dict) else []
        normalized_top: list[dict] = []
        seen_ids: set[str] = set()
        if isinstance(top_items, list):
            for item in top_items:
                if not isinstance(item, dict):
                    continue
                preset_id = str(item.get("preset_id", "")).strip()
                if not preset_id or preset_id in seen_ids:
                    continue
                if preset_id not in preset_ids:
                    warnings.append(f"LLM 返回未知 preset_id: {preset_id}")
                    continue
                seen_ids.add(preset_id)
                score_value = item.get("score", 0)
                try:
                    score = int(float(score_value))
                except Exception:
                    score = 0
                score = max(0, min(100, score))
                reasons = item.get("reasons", [])
                if not isinstance(reasons, list):
                    reasons = []
                normalized_top.append(
                    {
                        "preset_id": preset_id,
                        "score": score,
                        "reasons": [str(reason).strip() for reason in reasons if str(reason).strip()][:2] or ["内容匹配"],
                    }
                )
                if len(normalized_top) >= top_k:
                    break
        normalized_rows.append(
            {
                "character": name,
                "top": normalized_top,
            }
        )
    return normalized_rows, warnings


def split_tag_text(tag_text: str) -> list[str]:
    chunks = _WORD_SPLIT_PATTERN.split(tag_text or "")
    merged = []
    for chunk in chunks:
        normalized = chunk.strip()
        if normalized:
            merged.append(normalized)
    return normalize_tags(merged)
