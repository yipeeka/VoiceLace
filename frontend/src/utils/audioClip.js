export const MIN_AUDIO_CLIP_DURATION_SEC = 0.25;
const FULL_RANGE_TOLERANCE_SEC = 0.05;

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stripExtension(fileName) {
  const normalized = String(fileName || "audio").trim() || "audio";
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex > 0 ? normalized.slice(0, dotIndex) : normalized;
}

function formatFileTime(seconds) {
  return `${Math.max(0, Math.round(toFiniteNumber(seconds) * 1000))}ms`;
}

export function formatClipTime(seconds) {
  const safeSeconds = Math.max(0, toFiniteNumber(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const millis = Math.floor((safeSeconds % 1) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function normalizeClipRange(range, durationSec) {
  const duration = toFiniteNumber(durationSec);
  if (!range || duration <= 0) return null;

  const rawStart = toFiniteNumber(range.startSec, 0);
  const rawEnd = toFiniteNumber(range.endSec, duration);
  const start = clamp(Math.min(rawStart, rawEnd), 0, duration);
  const end = clamp(Math.max(rawStart, rawEnd), 0, duration);

  return { startSec: start, endSec: end };
}

export function isFullClipRange(range, durationSec, toleranceSec = FULL_RANGE_TOLERANCE_SEC) {
  const normalized = normalizeClipRange(range, durationSec);
  const duration = toFiniteNumber(durationSec);
  if (!normalized || duration <= 0) return true;
  return normalized.startSec <= toleranceSec && Math.abs(normalized.endSec - duration) <= toleranceSec;
}

export function getClipDurationSec(range, durationSec) {
  const normalized = normalizeClipRange(range, durationSec);
  if (!normalized) return 0;
  return Math.max(0, normalized.endSec - normalized.startSec);
}

export function validateClipRange(range, durationSec, minDurationSec = MIN_AUDIO_CLIP_DURATION_SEC) {
  const normalized = normalizeClipRange(range, durationSec);
  const duration = toFiniteNumber(durationSec);
  if (!normalized || duration <= 0 || isFullClipRange(normalized, duration)) return null;
  if (normalized.endSec - normalized.startSec < minDurationSec) {
    throw new Error(`截取范围至少需要 ${minDurationSec.toFixed(2)} 秒。`);
  }
  return normalized;
}

export function buildClipFileName(fileName, range) {
  const normalized = normalizeClipRange(range, Math.max(toFiniteNumber(range?.startSec), toFiniteNumber(range?.endSec), 0));
  if (!normalized) return `${stripExtension(fileName)}-clip.wav`;
  return `${stripExtension(fileName)}-clip-${formatFileTime(normalized.startSec)}-${formatFileTime(normalized.endSec)}.wav`;
}

export function encodeAudioBufferToWavArrayBuffer(audioBuffer) {
  const numberOfChannels = Math.max(1, Number(audioBuffer?.numberOfChannels || 1));
  const sampleRate = Math.max(1, Number(audioBuffer?.sampleRate || 44100));
  const length = Math.max(0, Number(audioBuffer?.length || 0));
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: numberOfChannels }, (_, channelIndex) => {
    const data = audioBuffer.getChannelData(channelIndex);
    return data instanceof Float32Array ? data : new Float32Array(data || []);
  });

  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
      const sample = clamp(channelData[channelIndex][sampleIndex] || 0, -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

async function renderClipWithOfflineContext(audioBuffer, range) {
  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const startFrame = Math.floor(range.startSec * sampleRate);
  const frameCount = Math.max(1, Math.floor((range.endSec - range.startSec) * sampleRate));
  const OfflineAudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offlineContext = new OfflineAudioContextCtor(numberOfChannels, frameCount, sampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0, startFrame / sampleRate, frameCount / sampleRate);
  return offlineContext.startRendering();
}

function createAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("当前浏览器不支持音频解码。");
  }
  return new AudioContextCtor();
}

export async function createClippedWavBlob(sourceBlob, range, durationSec) {
  const normalized = validateClipRange(range, durationSec);
  if (!normalized) {
    return { blob: sourceBlob, range: null };
  }

  let audioContext = null;
  try {
    audioContext = createAudioContext();
    const sourceBuffer = await sourceBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0));
    const rendered = await renderClipWithOfflineContext(decoded, normalized);
    return {
      blob: new Blob([encodeAudioBufferToWavArrayBuffer(rendered)], { type: "audio/wav" }),
      range: normalized,
    };
  } catch (error) {
    throw new Error(`音频截取失败：${error?.message || "无法解码音频"}`);
  } finally {
    await audioContext?.close?.().catch?.(() => undefined);
  }
}
