export function normalizeQcSeverity(value) {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "";
}

export function qcSeverityRank(value) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

export function qcSeverityShortLabel(value) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "";
}

export function extractQcIssueSegmentIds(issue) {
  const ids = [];
  const addId = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      ids.push(normalized);
    }
  };

  addId(issue?.segment_id);
  (Array.isArray(issue?.segment_ids) ? issue.segment_ids : []).forEach(addId);
  (Array.isArray(issue?.segments) ? issue.segments : []).forEach((item) => {
    if (typeof item === "string") {
      addId(item);
      return;
    }
    addId(item?.id || item?.segment_id);
  });
  (Array.isArray(issue?.evidence?.items) ? issue.evidence.items : []).forEach((item) => {
    addId(item?.segment_id || item?.id);
  });

  return Array.from(new Set(ids));
}

function compareRiskDetails(a, b) {
  const severityDelta = qcSeverityRank(b.severity) - qcSeverityRank(a.severity);
  if (severityDelta) return severityDelta;
  return a.sourceIndex - b.sourceIndex;
}

export function buildQcDisplayBySegmentId(issues) {
  const detailsBySegmentId = {};

  (Array.isArray(issues) ? issues : []).forEach((issue, sourceIndex) => {
    const severity = normalizeQcSeverity(issue?.severity) || "low";
    const title = String(issue?.title || issue?.type || "").trim();
    const description = String(issue?.description || "").trim();
    const detail = {
      severity,
      title,
      description,
      type: String(issue?.type || "").trim(),
      sourceIndex,
    };

    extractQcIssueSegmentIds(issue).forEach((segmentId) => {
      if (!detailsBySegmentId[segmentId]) {
        detailsBySegmentId[segmentId] = [];
      }
      detailsBySegmentId[segmentId].push(detail);
    });
  });

  const severityBySegmentId = {};
  const primaryRiskBySegmentId = {};
  const riskCountBySegmentId = {};
  const highlightBySegmentId = {};

  Object.entries(detailsBySegmentId).forEach(([segmentId, details]) => {
    const sorted = [...details].sort(compareRiskDetails);
    const primary = sorted[0];
    if (!primary) return;
    severityBySegmentId[segmentId] = primary.severity;
    highlightBySegmentId[segmentId] = primary.severity;
    primaryRiskBySegmentId[segmentId] = primary;
    riskCountBySegmentId[segmentId] = sorted.length;
  });

  return {
    detailsBySegmentId,
    severityBySegmentId,
    primaryRiskBySegmentId,
    riskCountBySegmentId,
    highlightBySegmentId,
  };
}
