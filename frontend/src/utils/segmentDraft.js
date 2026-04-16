import { getErrorMessage } from "./errors.js";

const SUPPORTED_TTS_OVERRIDE_FIELDS = new Set(["speed", "duration", "denoise", "num_step", "guidance_scale"]);

export function parseCsvList(input) {
  return String(input || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseOverridesJson(input) {
  try {
    const parsed = JSON.parse(input || "{}");
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("tts_overrides must be a JSON object");
    }
    const unknownFields = Object.keys(parsed).filter((key) => !SUPPORTED_TTS_OVERRIDE_FIELDS.has(key));
    if (unknownFields.length > 0) {
      throw new Error(`Unsupported tts_overrides field: ${unknownFields.join(", ")}`);
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "Invalid JSON") };
  }
}
