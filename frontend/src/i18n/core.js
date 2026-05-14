import { MESSAGES } from "./messages.js";

const STORAGE_KEY = "voicelace.language";
const SUPPORTED_LANGUAGES = new Set(["zh", "en"]);

let activeLanguage = "zh";
const listeners = new Set();

let reverseZhIndex = null;

function detectBrowserLanguage() {
  if (typeof navigator === "undefined") return "zh";
  return String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function normalizeLanguage(input) {
  return SUPPORTED_LANGUAGES.has(input) ? input : "zh";
}

function emitLanguageChange() {
  for (const listener of listeners) {
    listener(activeLanguage);
  }
}

function setDocumentLanguage(language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
}

function buildReverseZhIndex() {
  if (reverseZhIndex) return reverseZhIndex;
  const map = new Map();
  const zh = MESSAGES?.zh || {};
  Object.entries(zh).forEach(([key, value]) => {
    if (typeof value !== "string") return;
    if (!map.has(value)) {
      map.set(value, key);
    }
  });
  reverseZhIndex = map;
  return reverseZhIndex;
}

function formatTemplate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

export function initializeLanguage() {
  if (typeof window === "undefined") return activeLanguage;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  activeLanguage = normalizeLanguage(stored || detectBrowserLanguage());
  setDocumentLanguage(activeLanguage);
  return activeLanguage;
}

export function getLanguage() {
  return activeLanguage;
}

export function setLanguage(language) {
  const normalized = normalizeLanguage(language);
  activeLanguage = normalized;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }
  setDocumentLanguage(normalized);
  emitLanguageChange();
}

export function subscribeLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function translate(source, params = {}, language = activeLanguage) {
  const lang = normalizeLanguage(language);
  const dict = MESSAGES?.[lang] || MESSAGES?.zh || {};
  const fallbackDict = MESSAGES?.en || {};

  // Preferred path: source is an explicit i18n key.
  if (Object.prototype.hasOwnProperty.call(dict, source)) {
    return formatTemplate(dict[source], params);
  }
  if (Object.prototype.hasOwnProperty.call(fallbackDict, source)) {
    return formatTemplate(fallbackDict[source], params);
  }

  // Compatibility path: source is legacy zh literal text.
  const zhKey = buildReverseZhIndex().get(String(source));
  if (zhKey) {
    const localized = dict[zhKey] ?? fallbackDict[zhKey] ?? source;
    return formatTemplate(localized, params);
  }

  // Final fallback: keep original text untouched.
  return formatTemplate(source, params);
}

export function translateUiText(text, language = activeLanguage) {
  return translate(String(text || ""), {}, language);
}
