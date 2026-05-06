export function buildStaleTargetIds(report) {
  if (!report) {
    return [];
  }
  const missing = Array.isArray(report.missing_segment_ids) ? report.missing_segment_ids : [];
  const stale = Array.isArray(report.stale_segment_ids) ? report.stale_segment_ids : [];
  return [...new Set([...missing, ...stale])];
}

const AUTO_SELECT_REASONS = new Set([
  "missing_audio",
  "text_changed",
  "speaker_changed",
  "type_changed",
  "emotion_changed",
  "tts_overrides_changed",
]);

export function buildRecommendedRegenerateIds(report) {
  if (!report || !Array.isArray(report.items)) {
    return buildStaleTargetIds(report);
  }
  const ids = [];
  report.items.forEach((item) => {
    if (!item || !item.segment_id) {
      return;
    }
    if (item.status === "missing") {
      ids.push(item.segment_id);
      return;
    }
    const reasons = Array.isArray(item.reasons) ? item.reasons : [];
    if (reasons.some((reason) => AUTO_SELECT_REASONS.has(reason))) {
      ids.push(item.segment_id);
    }
  });
  return [...new Set(ids)];
}

export function resolveSegmentDisplayStatus(baseStatus, staleStatus) {
  if ((baseStatus || "").toLowerCase() === "failed") {
    return "failed";
  }
  if (staleStatus === "missing" || staleStatus === "stale") {
    return staleStatus;
  }
  return baseStatus;
}

export function resolveWorkflowStatus(displayStatus) {
  const value = (displayStatus || "").toLowerCase();
  if (value === "failed") return "failed";
  if (value === "missing") return "missing";
  if (value === "stale") return "stale";
  if (value === "done") return "done";
  return "other";
}

export function getSegmentStaleLabel(item) {
  if (!item) {
    return "";
  }
  if (item.status === "missing") {
    return "缺失音频";
  }
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  if (reasons.some((reason) => AUTO_SELECT_REASONS.has(reason) && reason !== "missing_audio")) {
    return "已修改待重新生成";
  }
  if (item.status === "stale") {
    return "配置变化待重新生成";
  }
  return "已同步";
}
