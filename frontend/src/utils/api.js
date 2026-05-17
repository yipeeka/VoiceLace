const configuredBaseUrl = import.meta.env?.VITE_API_BASE_URL;
const BASE_URL = (configuredBaseUrl?.trim() || "http://127.0.0.1:8050/api/v1").replace(/\/$/, "");
const parsedBase = new URL(BASE_URL);

class ApiError extends Error {
  constructor(message, { status, path, raw, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.raw = raw;
    this.details = details;
  }
}

export const API_BASE_URL = BASE_URL;
export const API_ORIGIN = parsedBase.origin;
export const API_PREFIX = parsedBase.pathname;
export function getWsBaseUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${parsedBase.host}${API_PREFIX}`;
}

function parseValidationDetails(details) {
  if (!Array.isArray(details) || !details.length) {
    return "";
  }
  return details
    .map((item) => {
      const loc = Array.isArray(item?.loc) ? item.loc.join(".") : "";
      const msg = item?.msg || item?.message || "参数错误";
      return loc ? `${loc}: ${msg}` : msg;
    })
    .join("; ");
}

async function buildApiError(response, path) {
  const rawText = await response.text();
  let message = "";
  let details = null;

  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed?.detail === "string") {
      message = parsed.detail;
      details = parsed.detail;
    } else if (Array.isArray(parsed?.detail)) {
      message = parseValidationDetails(parsed.detail);
      details = parsed.detail;
    } else if (typeof parsed?.message === "string") {
      message = parsed.message;
    }
  } catch {
    message = rawText;
  }

  const normalized = message?.trim() || rawText?.trim() || `HTTP ${response.status}`;
  return new ApiError(normalized, {
    status: response.status,
    path,
    raw: rawText,
    details,
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    throw await buildApiError(response, path);
  }
  if (response.headers.get("content-type")?.includes("application/json")) {
    return response.json();
  }
  return response;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  put: (path, body) =>
    request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  delete: (path) =>
    request(path, {
      method: "DELETE",
    }),
  postBlob: async (path, body) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await buildApiError(response, path);
    }
    return response.blob();
  },
  uploadFile: async (path, file) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw await buildApiError(response, path);
    }
    return response.json();
  },
  uploadForm: async (path, formData) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw await buildApiError(response, path);
    }
    return response.json();
  },
};
