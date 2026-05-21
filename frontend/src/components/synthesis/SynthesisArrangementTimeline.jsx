import { Music2, Trees, MoveHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  ARRANGEMENT_SNAP_MS,
  MIN_ARRANGEMENT_SEGMENT_DURATION_MS,
  moveArrangementSegment,
  normalizeArrangementDraft,
  resizeArrangementSegment,
} from "../../utils/audioArrangement";

function formatMs(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms) || 0));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatSignedMs(ms) {
  const value = Math.round(Number(ms) || 0);
  return `${value > 0 ? "+" : ""}${value}ms`;
}

function toPositiveMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function resolveTrackDurationMs(trackConfig, measuredDurationMs = 0) {
  const candidates = [
    measuredDurationMs,
    trackConfig?.duration_ms,
    trackConfig?.audio_duration_ms,
    trackConfig?.durationMs,
    Number(trackConfig?.duration_seconds) > 0 ? Number(trackConfig.duration_seconds) * 1000 : 0,
    Number(trackConfig?.audio_duration) > 0 ? Number(trackConfig.audio_duration) * 1000 : 0,
    Number(trackConfig?.duration_sec) > 0 ? Number(trackConfig.duration_sec) * 1000 : 0,
  ];
  return candidates.map(toPositiveMs).find((value) => value > 0) || 0;
}

function speakerHue(name) {
  let hash = 0;
  const text = String(name || "narrator");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

function buildRuler(totalMs) {
  const durationSec = Math.max(1, Math.ceil(totalMs / 1000));
  const intervalSec = durationSec > 240 ? 60 : durationSec > 120 ? 30 : durationSec > 45 ? 10 : 5;
  const ticks = [];
  for (let sec = 0; sec <= durationSec; sec += intervalSec) {
    ticks.push(sec * 1000);
  }
  return ticks;
}

function buildWaveformBars(seed, count = 38) {
  let state = 2166136261;
  const text = String(seed || "waveform");
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return Array.from({ length: count }, (_, index) => {
    state = (Math.imul(state + index + 17, 1103515245) + 12345) >>> 0;
    return 18 + (state % 80);
  });
}

function WaveformPreview({ seed, muted = false, count = 38 }) {
  return (
    <span className={`arrangementBlockWaveform ${muted ? "muted" : ""}`} aria-hidden="true">
      {buildWaveformBars(seed, count).map((height, index) => (
        <i key={`${seed}-${index}`} style={{ height: `${height}%` }} />
      ))}
    </span>
  );
}

function TrackWaveformPreview({ repeats, seed }) {
  if (!repeats.length) return null;
  return (
    <span className="arrangementTrackWaveform" aria-hidden="true">
      {repeats.map((item) => (
        <span
          key={`${seed}-${item.index}`}
          className="arrangementTrackRepeat"
          style={{
            left: `${item.leftPercent}%`,
            width: `${item.widthPercent}%`,
          }}
        >
          <WaveformPreview seed={`${seed}-${item.index}`} count={96} />
        </span>
      ))}
    </span>
  );
}

export default function SynthesisArrangementTimeline({
  draft,
  fullAudioDurationMs = 0,
  currentTimeMs = 0,
  onDraftChange,
  config,
  onSetConfig,
  warnings = {},
  bgmBound = false,
  ambienceBound = false,
  bgmDurationMs = 0,
  ambienceDurationMs = 0,
  syncPixelsPerSecond = 0,
  syncScrollWidth = 0,
  syncClientWidth = 0,
  scrollLeft = 0,
  onScrollLeftChange,
  disabled = false,
  embedded = false,
}) {
  const canvasRef = useRef(null);
  const scrollerRef = useRef(null);
  const syncingScrollRef = useRef(false);
  const normalizedDraft = useMemo(() => normalizeArrangementDraft(draft), [draft]);
  const contentTotalMs = useMemo(() => {
    const segmentEndMs = normalizedDraft.segments.reduce((max, item) => Math.max(max, item.endMs), 0);
    return Math.max(3000, Number(fullAudioDurationMs || 0), segmentEndMs);
  }, [normalizedDraft.segments, fullAudioDurationMs]);
  const syncedPxPerMs = Number(syncPixelsPerSecond) > 0 ? Number(syncPixelsPerSecond) / 1000 : 0;
  const fallbackCanvasWidth = Math.max(Number(syncClientWidth || 0), 820, Math.min(5200, 240 + (contentTotalMs / 1000) * 38));
  const fallbackPxPerMs = fallbackCanvasWidth / contentTotalMs;
  const pxPerMs = syncedPxPerMs || fallbackPxPerMs;
  const canvasWidth = Math.max(
    Number(syncClientWidth || 0),
    Number(syncScrollWidth || 0),
    Math.ceil(contentTotalMs * pxPerMs),
  );
  const playheadLeft = Math.max(0, Math.min(canvasWidth, currentTimeMs * pxPerMs));
  const rulerTicks = useMemo(() => buildRuler(contentTotalMs), [contentTotalMs]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const nextScrollLeft = Math.max(0, Number(scrollLeft || 0));
    if (Math.abs(scroller.scrollLeft - nextScrollLeft) <= 1) {
      return undefined;
    }
    syncingScrollRef.current = true;
    scroller.scrollLeft = nextScrollLeft;
    const frame = requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollLeft]);

  function handleScrollerScroll(event) {
    if (syncingScrollRef.current) return;
    onScrollLeftChange?.(event.currentTarget.scrollLeft);
  }

  function startSegmentDrag(event, segmentId, mode) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const baseDraft = normalizedDraft;

    function handleMove(moveEvent) {
      const deltaMs = ((moveEvent.clientX - startX) / pxPerMs);
      const nextDraft = mode === "move"
        ? moveArrangementSegment(baseDraft, segmentId, deltaMs, { snapMs: ARRANGEMENT_SNAP_MS })
        : resizeArrangementSegment(baseDraft, segmentId, mode, deltaMs, {
          snapMs: ARRANGEMENT_SNAP_MS,
          minDurationMs: MIN_ARRANGEMENT_SEGMENT_DURATION_MS,
        });
      onDraftChange?.(nextDraft);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  function startTrackDrag(event, trackType) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const baseOffset = Number(config?.[key]?.offset_ms || 0);
    const maxOffsetMs = Math.max(0, contentTotalMs - MIN_ARRANGEMENT_SEGMENT_DURATION_MS);

    function handleMove(moveEvent) {
      const deltaMs = (moveEvent.clientX - startX) / pxPerMs;
      const rawOffsetMs = Math.max(0, Math.min(maxOffsetMs, baseOffset + deltaMs));
      const nextOffsetMs = Math.round(rawOffsetMs / ARRANGEMENT_SNAP_MS) * ARRANGEMENT_SNAP_MS;
      onSetConfig?.({
        [key]: {
          ...(config?.[key] || {}),
          offset_ms: nextOffsetMs,
        },
      });
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  function trackStyle(trackType, bound) {
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const offsetMs = Number(config?.[key]?.offset_ms || 0);
    if (!bound) {
      return {
        left: 0,
        width: 170,
        opacity: 0.48,
      };
    }
    const left = Math.max(0, Math.min(contentTotalMs, offsetMs) * pxPerMs);
    const visibleDurationMs = getTrackVisibleDurationMs(trackType);
    const width = Math.max(24, visibleDurationMs * pxPerMs);
    return {
      left,
      width,
      opacity: 1,
    };
  }

  function getTrackNaturalDurationMs(trackType) {
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const measuredDurationMs = trackType === "bgm" ? bgmDurationMs : ambienceDurationMs;
    return resolveTrackDurationMs(config?.[key], measuredDurationMs);
  }

  function getTrackPlaybackDurationMs(trackType) {
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const offsetMs = Math.max(0, Number(config?.[key]?.offset_ms || 0));
    const naturalDurationMs = getTrackNaturalDurationMs(trackType);
    const loopEnabled = Boolean(config?.[key]?.loop ?? true);
    if (!naturalDurationMs || loopEnabled) {
      return Math.max(0, contentTotalMs - offsetMs);
    }
    return naturalDurationMs;
  }

  function getTrackVisibleDurationMs(trackType) {
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const offsetMs = Math.max(0, Number(config?.[key]?.offset_ms || 0));
    return Math.max(0, Math.min(getTrackPlaybackDurationMs(trackType), contentTotalMs - offsetMs));
  }

  function trackDurationLabel(trackType, bound) {
    if (!bound) return "";
    const naturalDurationMs = getTrackNaturalDurationMs(trackType);
    return formatMs(naturalDurationMs || getTrackVisibleDurationMs(trackType));
  }

  function trackLoopLabel(trackType, bound) {
    if (!bound) return "";
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const naturalDurationMs = getTrackNaturalDurationMs(trackType);
    const visibleDurationMs = getTrackVisibleDurationMs(trackType);
    const loopEnabled = Boolean(config?.[key]?.loop ?? true);
    if (!naturalDurationMs || !loopEnabled || visibleDurationMs <= naturalDurationMs) return "";
    const count = Math.ceil(visibleDurationMs / naturalDurationMs);
    return ` · 循环 ${count} 次`;
  }

  function getTrackRepeats(trackType, bound) {
    if (!bound) return [];
    const key = trackType === "bgm" ? "bgm_track" : "ambience_track";
    const visibleDurationMs = getTrackVisibleDurationMs(trackType);
    if (!visibleDurationMs) return [];
    const naturalDurationMs = getTrackNaturalDurationMs(trackType);
    const loopEnabled = Boolean(config?.[key]?.loop ?? true);
    const repeatDurationMs = loopEnabled && naturalDurationMs > 0
      ? naturalDurationMs
      : visibleDurationMs;
    const repeats = [];
    let cursorMs = 0;
    let index = 0;
    while (cursorMs < visibleDurationMs && index < 72) {
      const durationMs = Math.min(repeatDurationMs, visibleDurationMs - cursorMs);
      repeats.push({
        index,
        leftPercent: (cursorMs / visibleDurationMs) * 100,
        widthPercent: Math.max(0.5, (durationMs / visibleDurationMs) * 100),
      });
      cursorMs += repeatDurationMs;
      index += 1;
    }
    return repeats;
  }

  return (
    <div className={`arrangementTimeline ${embedded ? "embedded" : ""}`}>
      <div className="arrangementTimelineHeader">
        <span className="muted">拖动片段和音轨调整位置</span>
        <span className="muted">吸附 {ARRANGEMENT_SNAP_MS}ms · 最短 {MIN_ARRANGEMENT_SEGMENT_DURATION_MS}ms</span>
      </div>

      <div
        ref={scrollerRef}
        className="arrangementTimelineScroller"
        onScroll={handleScrollerScroll}
      >
        <div ref={canvasRef} className="arrangementCanvas" style={{ width: canvasWidth }}>
          <div className="arrangementRuler">
            {rulerTicks.map((tick) => (
              <span key={tick} className="arrangementRulerTick" style={{ left: tick * pxPerMs }}>
                {formatMs(tick)}
              </span>
            ))}
          </div>
          <div className="arrangementPlayhead" style={{ left: playheadLeft }} aria-hidden="true" />

          <div className="arrangementLane arrangementSegmentLane">
            <div className="arrangementLaneLabel">分段</div>
            {normalizedDraft.segments.map((item) => {
              const itemWarnings = warnings[item.segmentId] || [];
              const hue = speakerHue(item.speaker);
              const left = item.startMs * pxPerMs;
              const width = Math.max(22, (item.endMs - item.startMs) * pxPerMs);
              return (
                <div
                  key={item.segmentId}
                  className={`arrangementSegmentBlock ${itemWarnings.length ? "warning" : ""}`}
                  style={{
                    left,
                    width,
                    "--segment-hue": hue,
                  }}
                  title={`${item.speaker} · ${formatMs(item.startMs)} - ${formatMs(item.endMs)}${itemWarnings.length ? ` · ${itemWarnings.join("、")}` : ""}`}
                >
                  <button
                    type="button"
                    className="arrangementResizeHandle left"
                    aria-label={`调整第 ${item.index + 1} 段起点`}
                    onPointerDown={(event) => startSegmentDrag(event, item.segmentId, "start")}
                  />
                  <button
                    type="button"
                    className="arrangementSegmentMove"
                    aria-label={`移动第 ${item.index + 1} 段`}
                    onPointerDown={(event) => startSegmentDrag(event, item.segmentId, "move")}
                  >
                    <WaveformPreview seed={`${item.segmentId}-${item.speaker}-${item.durationMs}`} />
                    <span className="arrangementSegmentIndex">#{item.index + 1}</span>
                    <span className="arrangementSegmentSpeaker">{item.speaker}</span>
                    <span className="arrangementSegmentDuration">{formatMs(item.endMs - item.startMs)}</span>
                    {itemWarnings.length ? <span className="arrangementWarningDot" aria-label={itemWarnings.join("、")} /> : null}
                  </button>
                  <button
                    type="button"
                    className="arrangementResizeHandle right"
                    aria-label={`调整第 ${item.index + 1} 段终点`}
                    onPointerDown={(event) => startSegmentDrag(event, item.segmentId, "end")}
                  />
                </div>
              );
            })}
          </div>

          <div className="arrangementLane arrangementAssetLane">
            <div className="arrangementLaneLabel">BGM</div>
            <button
              type="button"
              className="arrangementAssetBlock bgm"
              style={trackStyle("bgm", bgmBound)}
              disabled={!bgmBound || disabled}
              onPointerDown={(event) => startTrackDrag(event, "bgm")}
              aria-label="移动背景音乐偏移"
              title={`BGM 偏移 ${formatSignedMs(config?.bgm_track?.offset_ms || 0)} · 单段 ${trackDurationLabel("bgm", bgmBound) || "未绑定"}${trackLoopLabel("bgm", bgmBound)}`}
            >
              {bgmBound ? <TrackWaveformPreview repeats={getTrackRepeats("bgm", bgmBound)} seed={`${config?.bgm_track?.relpath || "bgm"}-${trackDurationLabel("bgm", bgmBound)}`} /> : null}
              <Music2 size={13} aria-hidden="true" focusable="false" />
              <span>{bgmBound ? "背景音乐" : "未绑定 BGM"}</span>
              <strong>{bgmBound ? trackDurationLabel("bgm", bgmBound) : formatSignedMs(config?.bgm_track?.offset_ms || 0)}</strong>
              <MoveHorizontal size={13} aria-hidden="true" focusable="false" />
            </button>
          </div>

          <div className="arrangementLane arrangementAssetLane">
            <div className="arrangementLaneLabel">环境</div>
            <button
              type="button"
              className="arrangementAssetBlock ambience"
              style={trackStyle("ambience", ambienceBound)}
              disabled={!ambienceBound || disabled}
              onPointerDown={(event) => startTrackDrag(event, "ambience")}
              aria-label="移动环境音偏移"
              title={`环境音偏移 ${formatSignedMs(config?.ambience_track?.offset_ms || 0)} · 单段 ${trackDurationLabel("ambience", ambienceBound) || "未绑定"}${trackLoopLabel("ambience", ambienceBound)}`}
            >
              {ambienceBound ? <TrackWaveformPreview repeats={getTrackRepeats("ambience", ambienceBound)} seed={`${config?.ambience_track?.relpath || "ambience"}-${trackDurationLabel("ambience", ambienceBound)}`} /> : null}
              <Trees size={13} aria-hidden="true" focusable="false" />
              <span>{ambienceBound ? "环境音" : "未绑定环境音"}</span>
              <strong>{ambienceBound ? trackDurationLabel("ambience", ambienceBound) : formatSignedMs(config?.ambience_track?.offset_ms || 0)}</strong>
              <MoveHorizontal size={13} aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
