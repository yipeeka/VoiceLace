export function sameIdSequence(a, b) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((id, index) => id === b[index]);
}

export function pruneSegmentDrafts(baseIds, drafts) {
  const allowed = new Set(Array.isArray(baseIds) ? baseIds : []);
  const next = {};
  Object.entries(drafts || {}).forEach(([id, value]) => {
    if (allowed.has(id)) {
      next[id] = value;
    }
  });
  return next;
}

export function reconcileSegmentOrder(baseIds, segmentOrder) {
  if (!Array.isArray(segmentOrder) || !segmentOrder.length) {
    return null;
  }
  const normalizedBaseIds = Array.isArray(baseIds) ? baseIds : [];
  const baseSet = new Set(normalizedBaseIds);
  const keptIds = segmentOrder.filter((id) => baseSet.has(id));
  const missingIds = normalizedBaseIds.filter((id) => !keptIds.includes(id));
  const nextOrder = [...keptIds, ...missingIds];
  return sameIdSequence(nextOrder, normalizedBaseIds) ? null : nextOrder;
}

function reindexSegments(segments) {
  return (segments || []).map((segment, index) => ({ ...segment, index }));
}

function normalizeSelectedIdSet(selectedIds) {
  return new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id || "")).filter(Boolean));
}

export function getSegmentSelectionMeta(segments = [], selectedIds = []) {
  const selectedIdSet = normalizeSelectedIdSet(selectedIds);
  const selected = [];
  (segments || []).forEach((segment, index) => {
    if (selectedIdSet.has(segment?.id)) {
      selected.push({ segment, index });
    }
  });
  const selectedIndexes = selected.map((item) => item.index);
  const firstIndex = selectedIndexes.length ? selectedIndexes[0] : -1;
  const lastIndex = selectedIndexes.length ? selectedIndexes[selectedIndexes.length - 1] : -1;
  const isContiguous = selectedIndexes.length > 0
    && selectedIndexes.every((index, offset) => index === firstIndex + offset);

  return {
    selectedIds: selected.map((item) => item.segment.id),
    selectedSegments: selected.map((item) => item.segment),
    selectedIndexes,
    count: selected.length,
    firstIndex,
    lastIndex,
    isContiguous,
  };
}

export function deleteSelectedSegments(segments = [], selectedIds = []) {
  const selectedIdSet = normalizeSelectedIdSet(selectedIds);
  if (!selectedIdSet.size) {
    return reindexSegments(segments);
  }
  return reindexSegments((segments || []).filter((segment) => !selectedIdSet.has(segment?.id)));
}

export function moveSelectedSegmentBlock(segments = [], selectedIds = [], overId = "") {
  const list = Array.isArray(segments) ? segments : [];
  const meta = getSegmentSelectionMeta(list, selectedIds);
  const targetIndex = list.findIndex((segment) => segment?.id === overId);
  if (!meta.isContiguous || meta.count <= 0 || targetIndex < 0) {
    return reindexSegments(list);
  }
  if (targetIndex >= meta.firstIndex && targetIndex <= meta.lastIndex) {
    return reindexSegments(list);
  }

  const selectedIdSet = new Set(meta.selectedIds);
  const block = list.slice(meta.firstIndex, meta.lastIndex + 1);
  const remaining = list.filter((segment) => !selectedIdSet.has(segment?.id));
  const remainingTargetIndex = remaining.findIndex((segment) => segment?.id === overId);
  if (remainingTargetIndex < 0) {
    return reindexSegments(list);
  }

  const insertIndex = targetIndex < meta.firstIndex ? remainingTargetIndex : remainingTargetIndex + 1;
  const next = [
    ...remaining.slice(0, insertIndex),
    ...block,
    ...remaining.slice(insertIndex),
  ];
  return reindexSegments(next);
}

export function mergeSelectedSegments(segments = [], selectedIds = []) {
  const list = Array.isArray(segments) ? segments : [];
  const meta = getSegmentSelectionMeta(list, selectedIds);
  if (!meta.isContiguous || meta.count < 2) {
    return reindexSegments(list);
  }

  const selectedIdSet = new Set(meta.selectedIds);
  const [firstSegment] = meta.selectedSegments;
  const mergedText = meta.selectedSegments
    .map((segment) => String(segment?.text || "").trim())
    .filter(Boolean)
    .join(" ");
  const mergedSegment = {
    ...firstSegment,
    text: mergedText,
  };
  const next = [
    ...list.slice(0, meta.firstIndex),
    mergedSegment,
    ...list.slice(meta.lastIndex + 1).filter((segment) => !selectedIdSet.has(segment?.id)),
  ];
  return reindexSegments(next);
}
