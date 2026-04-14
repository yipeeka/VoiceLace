import { getErrorMessage } from "./errors.js";

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
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, "Invalid JSON") };
  }
}
