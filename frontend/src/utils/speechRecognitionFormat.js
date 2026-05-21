export function formatTimestamp(ms) {
  const total = Math.max(0, Number(ms || 0));
  const hh = Math.floor(total / 3600000);
  const mm = Math.floor((total % 3600000) / 60000);
  const ss = Math.floor((total % 60000) / 1000);
  const mmm = Math.floor(total % 1000);
  const pad2 = (value) => String(value).padStart(2, "0");
  const pad3 = (value) => String(value).padStart(3, "0");
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`;
}

export function formatSrtTimestamp(ms) {
  return formatTimestamp(ms).replace(".", ",");
}

export function renderCuesAsSrt(cues) {
  return (Array.isArray(cues) ? cues : [])
    .map((cue, index) => {
      const text = String(cue?.raw_text || cue?.text || "").trim();
      const speaker = String(cue?.speaker || "").trim();
      const body = speaker && speaker !== "narrator" && !/^\s*[^：:\n]{1,40}\s*[：:]/.test(text)
        ? `${speaker}：${text}`
        : text;
      return [
        String(index + 1),
        `${formatSrtTimestamp(cue?.start_ms)} --> ${formatSrtTimestamp(cue?.end_ms)}`,
        body,
      ].join("\n");
    })
    .join("\n\n");
}

export function parseTimestampMs(value) {
  const raw = String(value || "").trim().replace(",", ".");
  const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;
  const [, hh, mm, ss, ms] = match;
  return ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(String(ms).padEnd(3, "0").slice(0, 3));
}

export function splitSpeakerText(value, fallbackSpeaker = "narrator") {
  const raw = String(value || "").trim();
  const match = raw.match(/^\s*([^：:\n]{1,40})\s*[：:]\s*(.+)$/s);
  if (!match) {
    return { speaker: fallbackSpeaker || "narrator", text: raw };
  }
  const candidate = String(match[1] || "").trim();
  if (!isSpeakerLabelCandidate(candidate)) {
    return { speaker: fallbackSpeaker || "narrator", text: raw };
  }
  const speaker = candidate || fallbackSpeaker || "narrator";
  const text = String(match[2] || "").trim();
  return { speaker, text };
}

function isSpeakerLabelCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, "");
  if (!compact || compact.length > 16) return false;
  if (/[，,。！？!?；;：“”"‘’'（）()\[\]【】《》<>、]/.test(compact)) return false;
  if (/(说道|问道|喊道|叫道|吆喝道|喃喃道|笑道|骂道|答道|应道|念道|喝道|道|说|问|喊|叫)$/.test(compact)) {
    return false;
  }
  return /^[\u4e00-\u9fffA-Za-z0-9 _.\-#]+$/.test(raw);
}

function normalizePositiveEndMs(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return null;
  return endMs === startMs ? startMs + 1 : endMs;
}

export function validateEditedSubtitleSrt(value) {
  const text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) {
    throw new Error("字幕预览为空，请先预览字幕或输入 SRT 内容。");
  }
  const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) {
    throw new Error("未找到可用 SRT 字幕块。");
  }
  const timeRe = /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;
  blocks.forEach((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((line) => timeRe.test(line));
    if (timeLineIndex < 0) {
      throw new Error(`第 ${index + 1} 个字幕块缺少有效时间轴。`);
    }
    const match = lines[timeLineIndex].match(timeRe);
    const startMs = parseTimestampMs(match?.[1]);
    const endMs = parseTimestampMs(match?.[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error(`第 ${index + 1} 个字幕块时间轴无效，需满足 start < end。`);
    }
    const body = lines.slice(timeLineIndex + 1).join("\n").trim();
    if (!body) {
      throw new Error(`第 ${index + 1} 个字幕块正文为空。`);
    }
  });
  return `${text}\n`;
}

export function collapseWhisperSegments(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const hasCjk = /[\u4e00-\u9fff]/.test(raw);
  return hasCjk ? parts.join("") : parts.join(" ");
}

export function stripTimelineText(text) {
  return String(text || "")
    .replace(/\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/g, "")
    .trim();
}

export function resolveAsrTimestampRequest({ backend, requested, qwen3Default }) {
  return String(backend || "").trim() === "qwen3_crispasr"
    ? Boolean(requested || qwen3Default)
    : false;
}

export function canBuildDubbingProjectFromAlignments({ translationMode, isTranslationEngineLoaded, alignmentCount }) {
  return Boolean(
    (translationMode === "passthrough" || isTranslationEngineLoaded) &&
    Number(alignmentCount || 0) > 0,
  );
}

export function buildDubbingSegmentsFromPreview({ alignments, previewText }) {
  const usableTimeline = (Array.isArray(alignments) ? alignments : [])
    .map((item, index) => {
      const startMs = Number.isFinite(Number(item?.start_ms)) ? Number(item.start_ms) : null;
      const rawEndMs = Number.isFinite(Number(item?.end_ms)) ? Number(item.end_ms) : null;
      const endMs = normalizePositiveEndMs(startMs, rawEndMs);
      return {
        id: String(item?.id || `asr-seg-${index + 1}`),
        speaker: String(item?.speaker || "narrator").trim() || "narrator",
        text: String(item?.text || "").trim(),
        start_ms: startMs,
        end_ms: endMs,
      };
    })
    .filter((item) => item.text && item.start_ms !== null && item.end_ms !== null);
  if (!usableTimeline.length) {
    throw new Error("请先完成 ASR 识别并拿到可用时间轴片段。");
  }
  const lines = String(previewText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    throw new Error("识别预览为空，请先编辑或完成识别。");
  }
  const timelineRe = /^\s*\[(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\]\s*(.+)$/s;
  const hasTimelineLines = lines.some((line) => timelineRe.test(line));
  if (hasTimelineLines) {
    return lines.map((line, index) => {
      const match = line.match(timelineRe);
      if (!match) {
        throw new Error(`第 ${index + 1} 行不是有效时间轴格式。`);
      }
      const startMs = parseTimestampMs(match[1]);
      const rawEndMs = parseTimestampMs(match[2]);
      const endMs = normalizePositiveEndMs(startMs, rawEndMs);
      if (!Number.isFinite(startMs) || endMs === null) {
        throw new Error(`第 ${index + 1} 行时间轴无效，需满足 start < end。`);
      }
      const base = usableTimeline[index] || {};
      const parsed = splitSpeakerText(match[3], base.speaker || "narrator");
      if (!parsed.text) {
        throw new Error(`第 ${index + 1} 行文本为空。`);
      }
      return {
        id: String(base.id || `asr-seg-${index + 1}`),
        speaker: parsed.speaker,
        text: parsed.text,
        start_ms: startMs,
        end_ms: endMs,
      };
    });
  }
  if (lines.length !== usableTimeline.length) {
    throw new Error(`普通文本模式需要 ${usableTimeline.length} 行非空文本，目前为 ${lines.length} 行。请切换“显示时间轴”后按时间轴格式编辑，或保持逐段等行。`);
  }
  return lines.map((line, index) => {
    const base = usableTimeline[index];
    const parsed = splitSpeakerText(line, base.speaker);
    if (!parsed.text) {
      throw new Error(`第 ${index + 1} 行文本为空。`);
    }
    return {
      ...base,
      speaker: parsed.speaker,
      text: parsed.text,
    };
  });
}

export function getDubbingTaskLabel(mode) {
  if (mode === "passthrough") return "直通配音任务排队中";
  if (mode === "polish_only") return "润色配音任务排队中";
  return "翻译配音任务排队中";
}

export function getDubbingProjectSuffix(mode) {
  if (mode === "passthrough") return "直通配音";
  if (mode === "polish_only") return "润色配音";
  return "翻译配音";
}

export function buildDubbingProjectName({ projectName, audioFileName, mode }) {
  const audioStem = String(audioFileName || "").replace(/\.[^.]+$/, "");
  const baseName = String(projectName || "").trim() || audioStem || "翻译配音";
  return `${baseName}-${getDubbingProjectSuffix(mode)}`;
}

function stripTimingOverrides(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return {};
  }
  const { duration, speed, ...modelOverrides } = overrides;
  return modelOverrides;
}

export function expandDubbingTimelineByDuration(translatedSegments) {
  return (Array.isArray(translatedSegments) ? translatedSegments : []).map((segment) => ({ ...segment }));
}

export function reconcileTranslatedDubbingSegments(sourceSegments, translatedSegments) {
  const translatedById = new Map(
    (Array.isArray(translatedSegments) ? translatedSegments : [])
      .map((segment) => [String(segment?.id || ""), segment])
      .filter(([id]) => id),
  );
  return (Array.isArray(sourceSegments) ? sourceSegments : [])
    .map((source, index) => {
      const id = String(source?.id || `asr-seg-${index + 1}`);
      const translated = translatedById.get(id) || {};
      const text = String(translated?.text || "").trim() || String(source?.text || "").trim();
      if (!text) return null;
      return {
        ...source,
        ...translated,
        id,
        speaker: String(translated?.speaker || source?.speaker || "narrator"),
        source_text: String(translated?.source_text || source?.text || "").trim(),
        text,
        start_ms: Number.isFinite(Number(translated?.start_ms)) ? Number(translated.start_ms) : source?.start_ms,
        end_ms: Number.isFinite(Number(translated?.end_ms)) ? Number(translated.end_ms) : source?.end_ms,
      };
    })
    .filter(Boolean);
}

export function buildTranslatedDubbingScriptPayload({
  payload,
  title,
  translationMode,
  translationSource,
  translationTargetLanguage,
  translatedSegments,
}) {
  const timelineSegments = expandDubbingTimelineByDuration(translatedSegments);
  return {
    title,
    source_text: String(payload?.translated_text || "").trim(),
    metadata: {
      asr_source: true,
      dubbing_source: true,
      dubbing_mode: String(payload?.mode || translationMode),
      dubbing_target_language: String(translationTargetLanguage || "中文"),
      dubbing_source_backend: String(translationSource || ""),
      dubbing_segment_count: Number(timelineSegments.length),
    },
    characters: [],
    segments: timelineSegments.map((segment, index) => {
      const segText = String(segment?.text || "").trim();
      const sourceText = String(segment?.source_text || "").trim();
      const startMs = Number.isFinite(Number(segment?.start_ms)) ? Number(segment.start_ms) : null;
      const endMs = Number.isFinite(Number(segment?.end_ms)) ? Number(segment.end_ms) : null;
      const durationMs = Number.isFinite(Number(segment?.duration_ms))
        ? Number(segment.duration_ms)
        : (startMs !== null && endMs !== null && endMs >= startMs ? endMs - startMs : null);
      const overrides = stripTimingOverrides(segment?.tts_overrides);
      return {
        id: String(segment?.id || `dub-seg-${index + 1}`),
        index,
        type: "dialogue",
        speaker: String(segment?.speaker || "narrator"),
        text: segText,
        emotion: "neutral",
        non_verbal: [],
        tts_overrides: overrides,
        source_text: sourceText,
        source_start_ms: startMs,
        source_end_ms: endMs,
        source_duration_ms: durationMs,
        timing_check: segment?.timing_check && typeof segment.timing_check === "object" && !Array.isArray(segment.timing_check)
          ? segment.timing_check
          : {},
      };
    }),
  };
}
