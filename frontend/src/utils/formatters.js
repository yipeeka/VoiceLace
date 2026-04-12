export function formatTimestamp(value) {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleString("zh-CN");
}
