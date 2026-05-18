import { formatTimestamp, parseTimestampMs } from "./speechRecognitionFormat.js";

export function getSegmentSourceTiming(segment) {
  const startMs = Number(segment?.source_start_ms);
  const endMs = Number(segment?.source_end_ms);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
    return null;
  }
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    durationSec: (endMs - startMs) / 1000,
  };
}

export function formatSegmentTimestamp(ms) {
  return Number.isFinite(Number(ms)) ? formatTimestamp(Number(ms)) : "";
}

export function parseSegmentTimestamp(value) {
  return parseTimestampMs(value);
}

const DEFAULT_DURATION_MISMATCH_THRESHOLDS = {
  targetLonger: {
    minDiffSec: 2.0,
    minRatio: 0.45,
  },
  targetShorter: {
    minDiffSec: 0.6,
    minRatio: 0.15,
  },
};

export function getSegmentDurationMismatch(segment, options = {}) {
  const timing = getSegmentSourceTiming(segment);
  const overrides = segment?.tts_overrides && typeof segment.tts_overrides === "object" && !Array.isArray(segment.tts_overrides)
    ? segment.tts_overrides
    : {};
  const expectedSec = Number(overrides.duration);
  if (!timing || !Number.isFinite(expectedSec) || expectedSec <= 0) {
    return null;
  }
  const diffSec = Math.abs(timing.durationSec - expectedSec);
  const ratio = timing.durationSec > 0 ? diffSec / timing.durationSec : 0;
  const direction = timing.durationSec >= expectedSec ? "target_longer" : "target_shorter";
  const thresholds = direction === "target_longer"
    ? { ...DEFAULT_DURATION_MISMATCH_THRESHOLDS.targetLonger, ...(options.targetLonger || {}) }
    : { ...DEFAULT_DURATION_MISMATCH_THRESHOLDS.targetShorter, ...(options.targetShorter || {}) };
  const isMismatch = diffSec >= thresholds.minDiffSec && ratio >= thresholds.minRatio;
  return {
    isMismatch,
    direction,
    targetSec: timing.durationSec,
    expectedSec,
    diffSec,
    ratio,
    minDiffSec: thresholds.minDiffSec,
    minRatio: thresholds.minRatio,
  };
}

export function buildSegmentTimingCheck(segment) {
  const mismatch = getSegmentDurationMismatch(segment);
  if (!mismatch || !mismatch.isMismatch) {
    return {};
  }
  return {
    duration_mismatch: {
      is_mismatch: Boolean(mismatch.isMismatch),
      direction: mismatch.direction,
      target_sec: Number(mismatch.targetSec.toFixed(3)),
      expected_sec: Number(mismatch.expectedSec.toFixed(3)),
      diff_sec: Number(mismatch.diffSec.toFixed(3)),
      ratio: Number(mismatch.ratio.toFixed(4)),
    },
  };
}

export function getStoredSegmentDurationMismatch(segment) {
  const raw = segment?.timing_check?.duration_mismatch;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const targetSec = Number(raw.target_sec);
  const expectedSec = Number(raw.expected_sec);
  const diffSec = Number(raw.diff_sec);
  const ratio = Number(raw.ratio);
  const direction = raw.direction === "target_shorter" ? "target_shorter" : "target_longer";
  if (!raw.is_mismatch || !Number.isFinite(targetSec) || !Number.isFinite(expectedSec)) {
    return null;
  }
  return {
    isMismatch: true,
    targetSec,
    expectedSec,
    diffSec: Number.isFinite(diffSec) ? diffSec : Math.abs(targetSec - expectedSec),
    ratio: Number.isFinite(ratio) ? ratio : 0,
    direction,
  };
}
