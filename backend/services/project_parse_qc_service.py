from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher

from backend.persistence import load_project


_PUNCT_SPACE_RE = re.compile(r"[\s\u3000，,。！？!?；;：:\"“”'‘’（）()\[\]【】《》<>·、\-]+")
_HAS_DIALOGUE_MARK_RE = re.compile(r"[“”\"「」『』]|：|:")
_NON_VERBAL_TAG_RE = re.compile(r"\[[^\[\]]+\]")


def _normalize_text(raw: str) -> str:
    return _PUNCT_SPACE_RE.sub("", raw or "").strip().lower()


def _strip_non_verbal_tags(raw: str) -> str:
    text = raw or ""
    # [sigh] / [laughter] 等非言语标签不应触发“漏段”误报
    return _NON_VERBAL_TAG_RE.sub(" ", text).strip()


def _coverage_tokens(raw: str) -> list[str]:
    base = (raw or "").strip()
    stripped = _strip_non_verbal_tags(base)
    tokens: list[str] = []
    for item in (base, stripped):
        candidate = item.strip()
        if candidate and candidate not in tokens:
            tokens.append(candidate)
    return tokens


def _split_source_units(source_text: str) -> list[str]:
    raw = (source_text or "").strip()
    if not raw:
        return []
    units = re.split(r"(?<=[。！？!?；;])|\n+", raw)
    return [item.strip() for item in units if item.strip()]


def _best_source_candidate(segment_text: str, source_units: list[str]) -> tuple[str, float]:
    seg_norm = _normalize_text(segment_text)
    if not seg_norm or not source_units:
        return "", 0.0
    best_text = ""
    best_score = 0.0
    for unit in source_units:
        score = SequenceMatcher(None, seg_norm, _normalize_text(unit)).ratio()
        if score > best_score:
            best_score = score
            best_text = unit
    return best_text, round(best_score, 4)


def _build_text_diff(source_text: str, segment_text: str) -> dict[str, str]:
    a = source_text or ""
    b = segment_text or ""
    matcher = SequenceMatcher(None, a, b)
    source_parts: list[str] = []
    segment_parts: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        src = a[i1:i2]
        seg = b[j1:j2]
        if tag == "equal":
            source_parts.append(src)
            segment_parts.append(seg)
            continue
        if tag in {"replace", "delete"} and src:
            source_parts.append(f"[-{src}-]")
        if tag in {"replace", "insert"} and seg:
            segment_parts.append(f"[+{seg}+]")
    return {
        "source_diff": "".join(source_parts),
        "segment_diff": "".join(segment_parts),
    }


def _find_coverage_issues(source_text: str, segments: list) -> tuple[list[dict], dict]:
    source = (source_text or "").replace("\u3000", "").strip()
    source_normalized = _normalize_text(source)
    cursor = 0
    missing_ids: list[str] = []
    out_of_order_ids: list[str] = []
    for segment in segments:
        content = (segment.text or "").strip()
        if not content:
            missing_ids.append(segment.id)
            continue
        token_candidates = _coverage_tokens(content)
        matched = False
        for token in token_candidates:
            pos = source.find(token, cursor)
            if pos >= 0:
                cursor = pos + len(token)
                matched = True
                break
        if matched:
            continue
        for token in token_candidates:
            fallback = source.find(token)
            if fallback >= 0:
                out_of_order_ids.append(segment.id)
                cursor = max(cursor, fallback + len(token))
                matched = True
                break
        if matched:
            continue

        # 宽松匹配：去掉标签/标点后仍能匹配原文，则视为“可定位”
        relaxed_matched = False
        for token in token_candidates:
            relaxed = _normalize_text(token)
            if relaxed and relaxed in source_normalized:
                relaxed_matched = True
                break
        if not relaxed_matched:
            missing_ids.append(segment.id)

    merged_segment_text = _normalize_text("".join((segment.text or "") for segment in segments))
    source_char_count = len(source_normalized)
    covered_chars = min(source_char_count, len(merged_segment_text))
    coverage_ratio = (covered_chars / source_char_count) if source_char_count else 1.0

    issues: list[dict] = []
    if missing_ids:
        source_units = _split_source_units(source_text)
        missing_items: list[dict] = []
        for idx, segment in enumerate(segments):
            if segment.id not in missing_ids:
                continue
            candidate, similarity = _best_source_candidate(segment.text or "", source_units)
            diff = _build_text_diff(candidate, segment.text or "")
            before_text = (segments[idx - 1].text or "").strip() if idx > 0 else ""
            after_text = (segments[idx + 1].text or "").strip() if idx < len(segments) - 1 else ""
            missing_items.append(
                {
                    "segment_id": segment.id,
                    "segment_text": (segment.text or "").strip(),
                    "source_candidate": candidate,
                    "similarity": similarity,
                    "before_context": before_text,
                    "after_context": after_text,
                    "source_diff": diff["source_diff"],
                    "segment_diff": diff["segment_diff"],
                }
            )
        issues.append(
            {
                "id": f"qc_cov_missing_{hashlib.md5(','.join(missing_ids).encode('utf-8')).hexdigest()[:8]}",
                "type": "coverage_missing",
                "severity": "high",
                "title": "疑似漏段",
                "description": f"有 {len(missing_ids)} 段文本无法在原文中定位。",
                "segment_ids": missing_ids,
                "evidence": {"missing_count": len(missing_ids), "items": missing_items},
            }
        )
    if out_of_order_ids:
        issues.append(
            {
                "id": f"qc_cov_order_{hashlib.md5(','.join(out_of_order_ids).encode('utf-8')).hexdigest()[:8]}",
                "type": "coverage_out_of_order",
                "severity": "medium",
                "title": "段落顺序疑似错位",
                "description": f"有 {len(out_of_order_ids)} 段可匹配但顺序异常。",
                "segment_ids": out_of_order_ids,
                "evidence": {"out_of_order_count": len(out_of_order_ids)},
            }
        )

    metrics = {
        "source_char_count": source_char_count,
        "covered_char_count": covered_chars,
        "coverage_ratio": round(coverage_ratio, 4),
        "coverage_missing_count": len(missing_ids),
        "coverage_out_of_order_count": len(out_of_order_ids),
    }
    return issues, metrics


def _find_character_issues(segments: list) -> tuple[list[dict], dict]:
    raw_names: dict[str, int] = {}
    variant_groups: dict[str, set[str]] = {}
    abnormal_names: list[str] = []

    for segment in segments:
        name = (segment.speaker or "").strip() or "narrator"
        raw_names[name] = raw_names.get(name, 0) + 1
        normalized = _normalize_text(name)
        if normalized:
            variant_groups.setdefault(normalized, set()).add(name)
        if len(name) > 20 or re.search(r"[，,。！？!?；;：:\"“”'‘’（）()\[\]【】<>/\\@#\$%\^&\*\+=\|~`]", name):
            abnormal_names.append(name)

    inconsistent_groups = [sorted(list(values)) for values in variant_groups.values() if len(values) > 1]
    issues: list[dict] = []
    if inconsistent_groups:
        issue_segment_ids = [
            segment.id
            for segment in segments
            if any((segment.speaker or "").strip() in group for group in inconsistent_groups)
        ]
        issues.append(
            {
                "id": f"qc_character_variant_{hashlib.md5(str(inconsistent_groups).encode('utf-8')).hexdigest()[:8]}",
                "type": "character_inconsistent",
                "severity": "medium",
                "title": "角色名疑似不一致",
                "description": f"发现 {len(inconsistent_groups)} 组可能同名变体。",
                "segment_ids": issue_segment_ids,
                "evidence": {"groups": inconsistent_groups},
            }
        )

    if abnormal_names:
        issues.append(
            {
                "id": f"qc_character_abnormal_{hashlib.md5(str(abnormal_names).encode('utf-8')).hexdigest()[:8]}",
                "type": "character_abnormal",
                "severity": "low",
                "title": "角色名格式可疑",
                "description": f"发现 {len(abnormal_names)} 个角色名包含异常符号或过长。",
                "segment_ids": [segment.id for segment in segments if (segment.speaker or "").strip() in abnormal_names],
                "evidence": {"names": sorted(set(abnormal_names))},
            }
        )

    metrics = {
        "character_count": len(raw_names),
        "character_variant_group_count": len(inconsistent_groups),
        "character_abnormal_name_count": len(set(abnormal_names)),
    }
    return issues, metrics


def _find_type_misclass_issues(segments: list) -> tuple[list[dict], dict]:
    suspect_ids: list[str] = []
    for segment in segments:
        text = (segment.text or "").strip()
        speaker = (segment.speaker or "").strip() or "narrator"
        seg_type = (segment.type or "").strip()
        has_dialogue_marker = bool(_HAS_DIALOGUE_MARK_RE.search(text))
        if seg_type == "dialogue" and speaker == "narrator" and has_dialogue_marker:
            suspect_ids.append(segment.id)
            continue
        if seg_type == "narration" and speaker != "narrator" and has_dialogue_marker:
            suspect_ids.append(segment.id)
            continue
        if seg_type == "dialogue" and speaker == "narrator" and len(text) > 40:
            suspect_ids.append(segment.id)

    issues: list[dict] = []
    if suspect_ids:
        issues.append(
            {
                "id": f"qc_type_suspect_{hashlib.md5(','.join(suspect_ids).encode('utf-8')).hexdigest()[:8]}",
                "type": "type_suspect",
                "severity": "medium",
                "title": "旁白/对白疑似误判",
                "description": f"发现 {len(suspect_ids)} 段可能类型不匹配。",
                "segment_ids": suspect_ids,
                "evidence": {},
            }
        )
    return issues, {"type_suspect_count": len(suspect_ids)}


def _find_long_segment_issues(segments: list, limit: int = 35) -> tuple[list[dict], dict]:
    over_limit_ids = [segment.id for segment in segments if len((segment.text or "").strip()) > limit]
    issues: list[dict] = []
    if over_limit_ids:
        issues.append(
            {
                "id": f"qc_long_{hashlib.md5(','.join(over_limit_ids).encode('utf-8')).hexdigest()[:8]}",
                "type": "segment_too_long",
                "severity": "low",
                "title": "超长片段",
                "description": f"有 {len(over_limit_ids)} 段超过 {limit} 字，建议拆分。",
                "segment_ids": over_limit_ids,
                "evidence": {"limit": limit},
            }
        )
    return issues, {"long_segment_count": len(over_limit_ids), "long_segment_limit": limit}


def _find_duplicate_issues(segments: list) -> tuple[list[dict], dict]:
    index_map: dict[str, list[str]] = {}
    for segment in segments:
        normalized = _normalize_text(segment.text or "")
        if not normalized:
            continue
        index_map.setdefault(normalized, []).append(segment.id)

    duplicate_groups = [ids for ids in index_map.values() if len(ids) > 1]
    issues: list[dict] = []
    if duplicate_groups:
        all_ids = [item for group in duplicate_groups for item in group]
        issues.append(
            {
                "id": f"qc_duplicate_{hashlib.md5(','.join(all_ids).encode('utf-8')).hexdigest()[:8]}",
                "type": "segment_duplicate",
                "severity": "medium",
                "title": "重复片段",
                "description": f"发现 {len(duplicate_groups)} 组疑似重复片段。",
                "segment_ids": all_ids,
                "evidence": {"groups": duplicate_groups},
            }
        )
    return issues, {"duplicate_group_count": len(duplicate_groups)}


def build_project_parse_qc_report(project_id: str, *, projects_dir) -> dict:
    project = load_project(projects_dir, project_id)
    script = project.script
    segments = list(script.segments or [])

    coverage_issues, coverage_metrics = _find_coverage_issues(script.source_text or "", segments)
    character_issues, character_metrics = _find_character_issues(segments)
    type_issues, type_metrics = _find_type_misclass_issues(segments)
    long_issues, long_metrics = _find_long_segment_issues(segments)
    duplicate_issues, duplicate_metrics = _find_duplicate_issues(segments)

    issues = coverage_issues + character_issues + type_issues + long_issues + duplicate_issues
    severity_score = {"high": 3, "medium": 2, "low": 1}
    issues.sort(key=lambda item: severity_score.get(item.get("severity", "low"), 0), reverse=True)

    metrics = {
        "segment_count": len(segments),
        **coverage_metrics,
        **character_metrics,
        **type_metrics,
        **long_metrics,
        **duplicate_metrics,
    }
    summary = {
        "project_id": project_id,
        "project_name": project.name,
        "issue_count": len(issues),
        "high_count": sum(1 for item in issues if item.get("severity") == "high"),
        "medium_count": sum(1 for item in issues if item.get("severity") == "medium"),
        "low_count": sum(1 for item in issues if item.get("severity") == "low"),
        "coverage_ratio": metrics.get("coverage_ratio", 1.0),
    }
    return {
        "summary": summary,
        "metrics": metrics,
        "issues": issues,
        "generated_at": project.updated_at.isoformat(),
    }
