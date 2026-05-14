import { parseCsvList, parseOverridesJson } from "../utils/segmentDraft";
import { getLanguage } from "../i18n/core";
import { MESSAGES } from "../i18n/messages";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

export function useSynthesisActions({
  currentProject,
  config,
  isRunning,
  selectedSegmentIds,
  startSynthesis,
  startPartialSynthesis,
  reset,
  refreshCurrentProject,
  importArchive,
  setSelectedSegmentIds,
  setRecentlyUpdatedSegmentId,
  updatedRowTimerRef,
  setEditingSegmentId,
  setSegmentDraft,
  segmentDraft,
  updateSegment,
  pushToast,
  cancelSynthesis,
}) {
  async function handleStart() {
    if (!currentProject?.id) return;
    reset();
    await startSynthesis({
      projectId: currentProject.id,
      config: {
        ...config,
        guidance_scale: Number(config.guidance_scale),
        num_step: Number(config.num_step),
        gap_duration_ms: Number(config.gap_duration_ms),
      },
    });
    await refreshCurrentProject(currentProject.id);
  }

  async function handlePartialSynthesis(segmentIds, { rebuildFull = true } = {}) {
    if (!currentProject?.id || !segmentIds?.length) return;
    await startPartialSynthesis({
      projectId: currentProject.id,
      config: {
        ...config,
        guidance_scale: Number(config.guidance_scale),
        num_step: Number(config.num_step),
        gap_duration_ms: Number(config.gap_duration_ms),
      },
      segmentIds,
      rebuildFull,
    });
    await refreshCurrentProject(currentProject.id);
    setSelectedSegmentIds([]);
  }

  async function handleSingleSegmentSynthesis(segmentId) {
    if (!segmentId) return;
    setSelectedSegmentIds([]);
    await handlePartialSynthesis([segmentId], { rebuildFull: false });
    setRecentlyUpdatedSegmentId(segmentId);
    if (updatedRowTimerRef.current) {
      clearTimeout(updatedRowTimerRef.current);
    }
    updatedRowTimerRef.current = setTimeout(() => {
      setRecentlyUpdatedSegmentId((current) => (current === segmentId ? null : current));
      updatedRowTimerRef.current = null;
    }, 1800);
  }

  async function handleRegenerateSelected(targetIds = selectedSegmentIds) {
    const ids = Array.isArray(targetIds) ? targetIds.filter(Boolean) : [];
    if (!ids.length || isRunning) {
      return;
    }
    const ok = window.confirm(t("synth.confirm.regenerateSelected", { count: ids.length }));
    if (!ok) {
      return;
    }
    await handlePartialSynthesis(ids);
  }

  async function handleImportArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importArchive(file);
    } catch (error) {
      const message = String(error?.message || error || t("script.toast.importFailedTitle"));
      pushToast({ title: t("synth.toast.importProjectZipFailed", { error: message }), tone: "error" });
    }
  }

  async function handleCancelSynthesis() {
    try {
      await cancelSynthesis();
    } catch (error) {
      const message = String(error?.message || error || t("synth.toast.cancelFailedTitle"));
      pushToast({ title: t("synth.toast.stopSynthesisFailed", { error: message }), tone: "error" });
    }
  }

  function beginEditSegment(segment) {
    const baseSegment = (currentProject?.script?.segments || []).find((item) => item.id === segment.segment_id);
    setEditingSegmentId(segment.segment_id);
    setSegmentDraft({
      speaker: baseSegment?.speaker || segment.speaker || "narrator",
      text: baseSegment?.text || segment.text || "",
      type: baseSegment?.type || segment.type || "dialogue",
      emotion: baseSegment?.emotion || segment.emotion || "neutral",
      nonVerbalText: Array.isArray(baseSegment?.non_verbal) ? baseSegment.non_verbal.join(", ") : "",
      ttsOverridesText: JSON.stringify(baseSegment?.tts_overrides || {}, null, 2),
    });
  }

  function cancelEditSegment() {
    setEditingSegmentId(null);
    setSegmentDraft(null);
  }

  async function saveEditedSegment(segment) {
    if (!currentProject?.id || !segmentDraft) {
      return;
    }
    const baseSegment = (currentProject.script?.segments || []).find((item) => item.id === segment.segment_id);
    if (!baseSegment) {
      pushToast({ title: t("synth.toast.segmentNotFoundCannotSave"), tone: "error" });
      return;
    }
    const parsed = parseOverridesJson(segmentDraft.ttsOverridesText || "{}");
    if (!parsed.ok) {
      pushToast({
        title: t("synth.toast.ttsOverridesInvalid", { error: parsed.error }),
        tone: "error",
      });
      return;
    }

    await updateSegment({
      projectId: currentProject.id,
      segmentId: segment.segment_id,
      segment: {
        ...baseSegment,
        speaker: (segmentDraft.speaker || "").trim() || "narrator",
        text: (segmentDraft.text || "").trim(),
        type: segmentDraft.type || "dialogue",
        emotion: segmentDraft.emotion || "neutral",
        non_verbal: parseCsvList(segmentDraft.nonVerbalText),
        tts_overrides: parsed.value,
      },
    });
    await refreshCurrentProject(currentProject.id);
    setSelectedSegmentIds((ids) => (ids.includes(segment.segment_id) ? ids : [...ids, segment.segment_id]));
    pushToast({ title: t("synth.toast.segmentUpdatedQueued"), tone: "success" });
    cancelEditSegment();
  }

  return {
    handleStart,
    handlePartialSynthesis,
    handleSingleSegmentSynthesis,
    handleRegenerateSelected,
    handleImportArchive,
    handleCancelSynthesis,
    beginEditSegment,
    cancelEditSegment,
    saveEditedSegment,
  };
}
