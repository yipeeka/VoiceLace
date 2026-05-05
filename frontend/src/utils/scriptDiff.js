function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSegment(segment, index = 0) {
  return {
    id: segment?.id || "",
    index,
    speaker: (segment?.speaker || "narrator").trim() || "narrator",
    text: (segment?.text || "").trim(),
    type: segment?.type || "dialogue",
    emotion: segment?.emotion || "neutral",
    non_verbal: normalizeArray(segment?.non_verbal).map((item) => String(item).trim()).filter(Boolean),
    tts_overrides: normalizeObject(segment?.tts_overrides),
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function segmentContentChanged(a, b) {
  return (
    a.speaker !== b.speaker ||
    a.text !== b.text ||
    a.type !== b.type ||
    a.emotion !== b.emotion ||
    !sameJson(a.non_verbal, b.non_verbal) ||
    !sameJson(a.tts_overrides, b.tts_overrides)
  );
}

function changedFields(a, b) {
  const fields = [];
  if (a.speaker !== b.speaker) fields.push("speaker");
  if (a.text !== b.text) fields.push("text");
  if (a.type !== b.type) fields.push("type");
  if (a.emotion !== b.emotion) fields.push("emotion");
  if (!sameJson(a.non_verbal, b.non_verbal)) fields.push("non_verbal");
  if (!sameJson(a.tts_overrides, b.tts_overrides)) fields.push("tts_overrides");
  return fields;
}

function briefText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 36) return normalized;
  return `${normalized.slice(0, 33)}...`;
}

export function computeScriptDiff(savedScript, draftScript) {
  const savedSegments = normalizeArray(savedScript?.segments).map((segment, index) =>
    normalizeSegment(segment, index)
  );
  const draftSegments = normalizeArray(draftScript?.segments).map((segment, index) =>
    normalizeSegment(segment, index)
  );

  const savedIds = savedSegments.map((segment) => segment.id);
  const draftIds = draftSegments.map((segment) => segment.id);
  const savedById = Object.fromEntries(savedSegments.map((segment) => [segment.id, segment]));
  const draftById = Object.fromEntries(draftSegments.map((segment) => [segment.id, segment]));

  const addedSegmentIds = draftIds.filter((id) => id && !savedById[id]);
  const removedSegmentIds = savedIds.filter((id) => id && !draftById[id]);
  const commonIds = draftIds.filter((id) => id && savedById[id]);
  const modifiedSegmentIds = commonIds.filter((id) =>
    segmentContentChanged(savedById[id], draftById[id])
  );
  const reordered = savedIds.length === draftIds.length && savedIds.some((id, idx) => id !== draftIds[idx]);

  const hasChanges =
    addedSegmentIds.length > 0 ||
    removedSegmentIds.length > 0 ||
    modifiedSegmentIds.length > 0 ||
    reordered;

  return {
    hasChanges,
    addedSegmentIds,
    removedSegmentIds,
    modifiedSegmentIds,
    reordered,
    addedSegments: addedSegmentIds.map((id) => {
      const seg = draftById[id];
      return {
        id,
        index: seg?.index ?? -1,
        speaker: seg?.speaker || "narrator",
        text: seg?.text || "",
        textPreview: briefText(seg?.text || ""),
      };
    }),
    removedSegments: removedSegmentIds.map((id) => {
      const seg = savedById[id];
      return {
        id,
        index: seg?.index ?? -1,
        speaker: seg?.speaker || "narrator",
        text: seg?.text || "",
        textPreview: briefText(seg?.text || ""),
      };
    }),
    modifiedSegments: modifiedSegmentIds.map((id) => {
      const before = savedById[id];
      const after = draftById[id];
      return {
        id,
        index: after?.index ?? before?.index ?? -1,
        beforeSpeaker: before?.speaker || "narrator",
        afterSpeaker: after?.speaker || "narrator",
        beforeText: before?.text || "",
        afterText: after?.text || "",
        beforeTextPreview: briefText(before?.text || ""),
        afterTextPreview: briefText(after?.text || ""),
        changedFields: changedFields(before, after),
      };
    }),
  };
}

export function normalizeDraftScript(baseScript) {
  const raw = baseScript || {};
  const segments = normalizeArray(raw.segments).map((segment, index) =>
    normalizeSegment(segment, index)
  );
  return {
    title: raw.title || "",
    source_text: raw.source_text || "",
    segments,
    characters: normalizeArray(raw.characters),
    metadata: normalizeObject(raw.metadata),
  };
}

export function buildScriptDiffSummary(diff) {
  const safe = diff || {};
  return {
    added: Number(safe.addedSegmentIds?.length || 0),
    removed: Number(safe.removedSegmentIds?.length || 0),
    modified: Number(safe.modifiedSegmentIds?.length || 0),
    reordered: Boolean(safe.reordered),
    hasChanges: Boolean(safe.hasChanges),
  };
}
