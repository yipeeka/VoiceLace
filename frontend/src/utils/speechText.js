export function appendSpeechText(baseText, incomingText) {
  const next = (incomingText || "").trim();
  if (!next) {
    return baseText || "";
  }
  const base = (baseText || "").trim();
  if (!base) {
    return next;
  }
  return `${base}\n\n${next}`;
}

export function replaceSpeechText(incomingText) {
  return (incomingText || "").trim();
}
