import { API_ORIGIN } from "./api";

export const GENDER_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "female", label: "Female（女声）" },
  { value: "male", label: "Male（男声）" },
];

export const AGE_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "child", label: "Child（儿童）" },
  { value: "young", label: "Young（青年）" },
  { value: "middle", label: "Middle-aged（中年）" },
  { value: "old", label: "Old（老年）" },
];

export const PITCH_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "low", label: "Low（低沉）" },
  { value: "medium", label: "Medium（适中）" },
  { value: "high", label: "High（高亢）" },
];

export const STYLE_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "calm", label: "Calm（平静）" },
  { value: "gentle", label: "Gentle（温柔）" },
  { value: "assertive", label: "Assertive（坚定）" },
  { value: "lively", label: "Lively（活泼）" },
  { value: "whisper", label: "Whisper（低语）" },
  { value: "dramatic", label: "Dramatic（戏剧）" },
];

export const BACKEND_OPTIONS = [
  { value: "omnivoice", label: "OmniVoice" },
  { value: "voxcpm2", label: "VoxCPM2" },
];

export const RECOMMEND_SOURCE_OPTIONS = [
  { value: "secondary_local", label: "小模型（默认）" },
  { value: "primary_local", label: "主模型" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
  { value: "rule", label: "规则推荐（不走 LLM）" },
];

export const QUALITY_FILTER_OPTIONS = [
  { value: "all", label: "全部质量" },
  { value: "pass", label: "质量通过" },
  { value: "warning", label: "质量告警" },
  { value: "fail", label: "质量失败" },
  { value: "unknown", label: "未检测" },
];

export const DEFAULT_OMNIVOICE_PROFILE = {
  voice_mode: "design",
  ref_audio_path: "",
  ref_text: "",
  gender: "",
  age: "",
  pitch: "",
  style: "",
  accent: "",
  dialect: "",
  custom_instruct: "",
  speed: 1.0,
  clone_denoise: true,
  clone_num_step: 32,
  clone_guidance_scale: 2.0,
};

export const DEFAULT_VOXCPM2_PROFILE = {
  voice_mode: "design",
  design_instruction: "",
  control_instruction: "",
  ref_audio_path: "",
  ref_text: "",
  use_hifi_clone: false,
  cfg_value: 2.0,
  inference_timesteps: 10,
  denoise: false,
};

export const emptyForm = {
  name: "",
  voice_mode: "design",
  description: "",
  gender: "",
  age: "",
  pitch: "",
  style: "",
  accent: "",
  dialect: "",
  custom_instruct: "",
  tags: [],
  favorite: false,
  sample_audio_path: "",
  suitable_role_description: "",
  quality_reports: {},
  speed: 1.0,
  clone_denoise: true,
  clone_num_step: 32,
  clone_guidance_scale: 2.0,
  backend_profiles: {
    omnivoice: { ...DEFAULT_OMNIVOICE_PROFILE },
    voxcpm2: { ...DEFAULT_VOXCPM2_PROFILE },
  },
};

export function buildLegacyInstructionFromPreset(preset = {}) {
  return [
    preset.gender,
    preset.age,
    preset.pitch,
    preset.style,
    preset.accent,
    preset.dialect,
    preset.custom_instruct,
  ].filter(Boolean).join(", ");
}

export function resolveOmniProfile(preset = {}) {
  const profile = preset?.backend_profiles?.omnivoice || {};
  return {
    ...DEFAULT_OMNIVOICE_PROFILE,
    ...profile,
    voice_mode: profile.voice_mode || preset.voice_mode || "design",
    ref_audio_path: profile.ref_audio_path ?? preset.ref_audio_path ?? "",
    ref_text: profile.ref_text ?? preset.ref_text ?? "",
    gender: profile.gender ?? preset.gender ?? "",
    age: profile.age ?? preset.age ?? "",
    pitch: profile.pitch ?? preset.pitch ?? "",
    style: profile.style ?? preset.style ?? "",
    accent: profile.accent ?? preset.accent ?? "",
    dialect: profile.dialect ?? preset.dialect ?? "",
    custom_instruct: profile.custom_instruct ?? preset.custom_instruct ?? "",
    speed: Number(profile.speed ?? preset.speed ?? 1),
    clone_denoise: profile.clone_denoise ?? preset.clone_denoise ?? true,
    clone_num_step: Number(profile.clone_num_step ?? preset.clone_num_step ?? 32),
    clone_guidance_scale: Number(profile.clone_guidance_scale ?? preset.clone_guidance_scale ?? 2),
  };
}

export function resolveVoxProfile(preset = {}) {
  const profile = preset?.backend_profiles?.voxcpm2 || {};
  return {
    ...DEFAULT_VOXCPM2_PROFILE,
    ...profile,
    voice_mode: profile.voice_mode || preset.voice_mode || "design",
    design_instruction: (profile.design_instruction ?? buildLegacyInstructionFromPreset(preset) ?? "").trim(),
    control_instruction: (profile.control_instruction ?? profile.design_instruction ?? buildLegacyInstructionFromPreset(preset) ?? "").trim(),
    ref_audio_path: profile.ref_audio_path ?? preset.ref_audio_path ?? "",
    ref_text: profile.ref_text ?? preset.ref_text ?? "",
    use_hifi_clone: Boolean(profile.use_hifi_clone ?? false),
    cfg_value: profile.cfg_value == null ? 2.0 : Number(profile.cfg_value),
    inference_timesteps: profile.inference_timesteps == null ? 10 : Number(profile.inference_timesteps),
    denoise: profile.denoise == null ? false : Boolean(profile.denoise),
  };
}

export function getProfileModeFromPreset(preset = {}, backend = "omnivoice") {
  const normalized = (backend || "omnivoice").toLowerCase();
  if (normalized === "voxcpm2") {
    return preset?.backend_profiles?.voxcpm2?.voice_mode || preset?.voice_mode || "design";
  }
  return preset?.backend_profiles?.omnivoice?.voice_mode || preset?.voice_mode || "design";
}

export function getProfileModeFromPayload(payload = {}, backend = "omnivoice") {
  const normalized = (backend || "omnivoice").toLowerCase();
  if (normalized === "voxcpm2") {
    return payload?.backend_profiles?.voxcpm2?.voice_mode || payload?.voice_mode || "design";
  }
  return payload?.backend_profiles?.omnivoice?.voice_mode || payload?.voice_mode || "design";
}

export function buildReferenceAudioUrl(path) {
  const value = (path || "").trim();
  if (!value) return "";
  return `${API_ORIGIN}/api/v1/voices/reference-audio?path=${encodeURIComponent(value)}`;
}

export function parseTags(text) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function resolvePresetQualityStatus(preset, backend = "omnivoice") {
  const report = preset?.quality_reports?.[backend];
  return report?.status || "unknown";
}

export function qualityStatusLabel(status) {
  if (status === "pass") return "质量通过";
  if (status === "warning") return "质量告警";
  if (status === "fail") return "质量失败";
  return "未检测";
}

export function isPlaceholderCharacterDescription(name, description) {
  const value = String(description || "").replace(/\s+/g, "");
  const normalizedName = String(name || "").replace(/\s+/g, "");
  if (!value) return false;
  return value === "角色档案" || value === `${normalizedName}的角色档案` || value === `${normalizedName}角色档案` || value.endsWith("的角色档案");
}
