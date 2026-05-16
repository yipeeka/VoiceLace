export const DEFAULT_MUSIC_FORM = {
  task_type: "text2music",
  prompt: "",
  lyrics: "",
  audio_duration: 30,
  vocal_language: "unknown",
  num_inference_steps: 8,
  seed: "",
  source_asset_name: "",
  reference_asset_name: "",
  bpm: "",
  keyscale: "",
  timesignature: "",
  track_name: "",
  complete_track_classes: "",
  repainting_start: "",
  repainting_end: "",
  audio_cover_strength: "1.0",
  guidance_scale: "7.0",
  shift: "3.0",
};

export const ACTIVE_MUSIC_STATUSES = new Set(["queued", "running", "cancel_requested"]);

export const MUSIC_STATUS_META = {
  idle: { label: "空闲", tone: "default" },
  queued: { label: "排队中", tone: "warning" },
  running: { label: "生成中", tone: "warning" },
  cancel_requested: { label: "取消中", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  canceled: { label: "已取消", tone: "default" },
  error: { label: "失败", tone: "warning" },
};

export const LANGUAGE_OPTIONS = [
  { value: "unknown", label: "自动/未知" },
  { value: "zh", label: "中文 (zh)" },
  { value: "en", label: "英文 (en)" },
  { value: "ja", label: "日文 (ja)" },
  { value: "ko", label: "韩文 (ko)" },
];

export const TURBO_SHIFT_OPTIONS = [
  { value: "1.0", label: "1.0 - 细节更多" },
  { value: "2.0", label: "2.0 - 平衡" },
  { value: "3.0", label: "3.0 - 结构更清晰" },
];

export const BASE_MIN_INFERENCE_STEPS = 32;
export const BASE_MAX_INFERENCE_STEPS = 100;
export const TURBO_DEFAULT_INFERENCE_STEPS = 8;
export const BASE_DEFAULT_INFERENCE_STEPS = 50;
export const MUSIC_CATEGORY_ALL = "all";
export const MUSIC_CATEGORY_UNCATEGORIZED = "uncategorized";

export const BPM_OPTIONS = [
  { value: "", label: "不指定" },
  { value: "60", label: "60" },
  { value: "70", label: "70" },
  { value: "80", label: "80" },
  { value: "90", label: "90" },
  { value: "100", label: "100" },
  { value: "110", label: "110" },
  { value: "120", label: "120" },
  { value: "130", label: "130" },
  { value: "140", label: "140" },
  { value: "150", label: "150" },
  { value: "160", label: "160" },
  { value: "180", label: "180" },
];

export const KEYSCALE_OPTIONS = [
  { value: "", label: "不指定" },
  { value: "C major", label: "C major" },
  { value: "G major", label: "G major" },
  { value: "D major", label: "D major" },
  { value: "A major", label: "A major" },
  { value: "E major", label: "E major" },
  { value: "B major", label: "B major" },
  { value: "F# major", label: "F# major" },
  { value: "F major", label: "F major" },
  { value: "Bb major", label: "Bb major" },
  { value: "Eb major", label: "Eb major" },
  { value: "Ab major", label: "Ab major" },
  { value: "A minor", label: "A minor" },
  { value: "E minor", label: "E minor" },
  { value: "B minor", label: "B minor" },
  { value: "F# minor", label: "F# minor" },
  { value: "C# minor", label: "C# minor" },
  { value: "G# minor", label: "G# minor" },
  { value: "D minor", label: "D minor" },
  { value: "G minor", label: "G minor" },
  { value: "C minor", label: "C minor" },
  { value: "F minor", label: "F minor" },
];

export const TIMESIGNATURE_OPTIONS = [
  { value: "", label: "不指定" },
  { value: "4/4", label: "4/4" },
  { value: "3/4", label: "3/4" },
  { value: "2/4", label: "2/4" },
  { value: "6/8", label: "6/8" },
  { value: "12/8", label: "12/8" },
  { value: "5/4", label: "5/4" },
  { value: "7/8", label: "7/8" },
];

export const ASSIST_SOURCE_OPTIONS = [
  { value: "secondary_local", label: "小模型" },
  { value: "primary_local", label: "主模型" },
  { value: "openai", label: "OpenAI API" },
  { value: "openai_compatible", label: "OpenAI 兼容 API" },
  { value: "gemini", label: "Gemini API" },
];

export const TASK_TYPE_OPTIONS = [
  { value: "text2music", label: "Text2Music" },
  { value: "cover", label: "Cover" },
  { value: "repaint", label: "Repaint" },
  { value: "lego", label: "Lego" },
  { value: "extract", label: "Extract" },
  { value: "complete", label: "Complete" },
];

export const MUSIC_MODEL_VARIANT_OPTIONS = [
  { value: "turbo", label: "Turbo" },
  { value: "base", label: "Base" },
];

export const TRACK_NAME_OPTIONS = [
  { value: "", label: "选择轨道" },
  { value: "vocals", label: "vocals" },
  { value: "drums", label: "drums" },
  { value: "bass", label: "bass" },
  { value: "guitar", label: "guitar" },
  { value: "piano", label: "piano" },
  { value: "strings", label: "strings" },
  { value: "other", label: "other" },
];

export function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function getDefaultInferenceSteps(modelVariant) {
  return String(modelVariant || "turbo").toLowerCase() === "base"
    ? BASE_DEFAULT_INFERENCE_STEPS
    : TURBO_DEFAULT_INFERENCE_STEPS;
}

export function normalizeSelectOptionValue(value, options, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const exact = options.find((item) => item.value === raw);
  if (exact) return exact.value;
  const normalized = raw.toLowerCase();
  const matched = options.find((item) => String(item.value || "").toLowerCase() === normalized);
  return matched ? matched.value : fallback;
}

export function normalizeNearestNumericOptionValue(value, options, fallback = "") {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const candidates = options
    .map((item) => Number(item.value))
    .filter((item) => Number.isFinite(item));
  if (candidates.length === 0) {
    return fallback;
  }
  const nearest = candidates.reduce((best, item) => {
    const bestDelta = Math.abs(best - numeric);
    const itemDelta = Math.abs(item - numeric);
    if (itemDelta < bestDelta) return item;
    if (itemDelta === bestDelta && item < best) return item;
    return best;
  }, candidates[0]);
  return String(nearest);
}

export function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function inferAssetNameFromResult(result) {
  const outputPath = result?.output_path;
  if (!outputPath) return "";
  const normalized = String(outputPath).replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

export function parseMusicEvent(data) {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data === "object") {
    return data;
  }
  return null;
}

export function normalizeAssetCategories(rawCategories) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(rawCategories) ? rawCategories : []) {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, builtin: Boolean(item?.builtin) });
  }
  if (!seen.has(MUSIC_CATEGORY_UNCATEGORIZED)) {
    out.unshift({ id: MUSIC_CATEGORY_UNCATEGORIZED, name: "未分类", builtin: true });
  }
  return out;
}
