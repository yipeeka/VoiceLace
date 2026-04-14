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
