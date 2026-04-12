export function getErrorMessage(error, fallback = "请求失败") {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function formatError(prefix, error, fallback = "请求失败") {
  return `${prefix}：${getErrorMessage(error, fallback)}`;
}
