export function buildCharacterStats(segments = []) {
  const counts = {};
  for (const segment of segments || []) {
    const name = (segment?.speaker || "narrator").trim() || "narrator";
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

export function buildSpeakerOptions(characters = [], { includeCreateOption = false } = {}) {
  const existing = (characters || []).map((item) => item.name).filter(Boolean);
  const withoutNarrator = existing.filter((name) => name !== "narrator");
  const options = [
    { value: "narrator", label: "narrator" },
    ...withoutNarrator.map((name) => ({ value: name, label: name })),
  ];
  if (includeCreateOption) {
    options.push({ value: "__new__", label: "+ 添加新角色" });
  }
  return options;
}

export function filterSegmentsBySpeaker(segments = [], activeSpeakerFilter = "all") {
  if (!activeSpeakerFilter || activeSpeakerFilter === "all") {
    return segments;
  }
  return (segments || []).filter((segment) => (segment?.speaker || "narrator") === activeSpeakerFilter);
}

export function filterSegmentsByWorkflowStatus(segments = [], activeStatusFilter = "all") {
  if (!activeStatusFilter || activeStatusFilter === "all") {
    return segments;
  }
  return (segments || []).filter((segment) => (segment?.workflow_status || "other") === activeStatusFilter);
}

export function pruneSelectedSegmentIds(selectedIds = [], visibleSegments = []) {
  const visibleIds = new Set((visibleSegments || []).map((segment) => segment.segment_id || segment.id).filter(Boolean));
  return (selectedIds || []).filter((id) => visibleIds.has(id));
}

function getSegmentListIds(segments = []) {
  return (segments || [])
    .map((segment) => segment?.segment_id || segment?.id)
    .filter(Boolean);
}

export function applySegmentSelectionClick({
  selectedIds = [],
  visibleSegments = [],
  targetId = "",
  checked = true,
  shiftKey = false,
  anchorId = "",
} = {}) {
  const visibleIds = getSegmentListIds(visibleSegments);
  if (!targetId || !visibleIds.includes(targetId)) {
    return selectedIds || [];
  }

  const selectedSet = new Set(selectedIds || []);
  const targetIndex = visibleIds.indexOf(targetId);
  const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1;
  if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    visibleIds.slice(start, end + 1).forEach((id) => {
      if (checked) {
        selectedSet.add(id);
      } else {
        selectedSet.delete(id);
      }
    });
  } else if (checked) {
    selectedSet.add(targetId);
  } else {
    selectedSet.delete(targetId);
  }

  const visibleIdSet = new Set(visibleIds);
  const orderedVisibleSelection = visibleIds.filter((id) => selectedSet.has(id));
  const hiddenSelection = (selectedIds || []).filter((id) => !visibleIdSet.has(id) && selectedSet.has(id));
  return [...hiddenSelection, ...orderedVisibleSelection];
}

export function getInsertAnchorLabel(segments = [], insertAfterSegmentId = null) {
  if (!insertAfterSegmentId) {
    return "";
  }
  const target = (segments || []).find((segment) => segment.id === insertAfterSegmentId || segment.segment_id === insertAfterSegmentId);
  if (!target) {
    return "";
  }
  return `将插入到 #${(target.index ?? 0) + 1} 之后`;
}
