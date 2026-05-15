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
  const speaker = String(match[1] || "").trim() || fallbackSpeaker || "narrator";
  const text = String(match[2] || "").trim();
  return { speaker, text };
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

export function buildDubbingSegmentsFromPreview({ alignments, previewText }) {
  const usableTimeline = (Array.isArray(alignments) ? alignments : [])
    .map((item, index) => ({
      id: String(item?.id || `asr-seg-${index + 1}`),
      speaker: String(item?.speaker || "narrator").trim() || "narrator",
      text: String(item?.text || "").trim(),
      start_ms: Number.isFinite(Number(item?.start_ms)) ? Number(item.start_ms) : null,
      end_ms: Number.isFinite(Number(item?.end_ms)) ? Number(item.end_ms) : null,
    }))
    .filter((item) => item.text && item.start_ms !== null && item.end_ms !== null && item.end_ms > item.start_ms);
  if (!usableTimeline.length) {
    throw new Error("请先完成 Whisper 识别并拿到可用时间轴片段。");
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
      const endMs = parseTimestampMs(match[2]);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
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

export function buildTranslatedDubbingScriptPayload({
  payload,
  title,
  translationMode,
  translationSource,
  translationTargetLanguage,
  translatedSegments,
}) {
  return {
    title,
    source_text: String(payload?.translated_text || "").trim(),
    metadata: {
      asr_source: true,
      dubbing_source: true,
      dubbing_mode: String(payload?.mode || translationMode),
      dubbing_target_language: String(translationTargetLanguage || "中文"),
      dubbing_source_backend: String(translationSource || ""),
      dubbing_segment_count: Number(translatedSegments.length),
    },
    characters: [],
    segments: translatedSegments.map((segment, index) => {
      const segText = String(segment?.text || "").trim();
      const sourceText = String(segment?.source_text || "").trim();
      const startMs = Number.isFinite(Number(segment?.start_ms)) ? Number(segment.start_ms) : null;
      const endMs = Number.isFinite(Number(segment?.end_ms)) ? Number(segment.end_ms) : null;
      const durationMs = Number.isFinite(Number(segment?.duration_ms))
        ? Number(segment.duration_ms)
        : (startMs !== null && endMs !== null && endMs >= startMs ? endMs - startMs : null);
      const overrides = segment?.tts_overrides && typeof segment.tts_overrides === "object" ? segment.tts_overrides : {};
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
      };
    }),
  };
}
