import { API_BASE_URL, api } from "./api.js";

export const PAGE_UNLOAD_ENDPOINTS = {
  speech: "/system/unload-asr",
  text: "/system/unload-llm",
  synth: "/system/unload-tts",
  music: "/system/unload-music",
};

export function getPageUnloadEndpoint(page) {
  return PAGE_UNLOAD_ENDPOINTS[page] || "";
}

export function isAutoSerialEnabled(systemStatus, orchestratorConfig) {
  if (orchestratorConfig && Object.prototype.hasOwnProperty.call(orchestratorConfig, "auto_serial")) {
    return Boolean(orchestratorConfig.auto_serial);
  }
  if (systemStatus?.config && Object.prototype.hasOwnProperty.call(systemStatus.config, "auto_serial")) {
    return Boolean(systemStatus.config.auto_serial);
  }
  if (systemStatus && Object.prototype.hasOwnProperty.call(systemStatus, "auto_serial")) {
    return Boolean(systemStatus.auto_serial);
  }
  return null;
}

export async function unloadModelForPage(page, apiClient = api) {
  const endpoint = getPageUnloadEndpoint(page);
  if (!endpoint) {
    return false;
  }
  await apiClient.post(endpoint, {});
  return true;
}

export function sendPageUnloadBeacon(page) {
  const endpoint = getPageUnloadEndpoint(page);
  if (!endpoint || typeof window === "undefined") {
    return false;
  }
  const url = `${API_BASE_URL}${endpoint}`;
  const body = JSON.stringify({});
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
  return true;
}
