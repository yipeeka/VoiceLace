import { useEffect, useMemo, useRef, useState } from "react";

const SPEAKER_HUES = [202, 124, 277, 38, 160, 326, 52, 188, 250, 18];
const SEGMENT_SNAP_MS = 50;
const MIN_SEGMENT_DURATION_MS = 300;
const waveImageCache = new Map();

function formatTickTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function hashString(value) {
  return String(value || "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function buildWaveBars(seed, count = 32) {
  return Array.from({ length: count }, (_, index) => {
    const phase = (seed + index * 17) % 31;
    const wave = Math.abs(Math.sin((phase + index) / 4));
    const jitter = ((seed + index * 11) % 9) / 14;
    return Math.max(18, Math.min(92, Math.round((wave * 0.64 + jitter) * 100)));
  });
}

function buildWaveImage(seed, count = 32, hue = 202) {
  const cacheKey = `${seed}:${count}:${hue}`;
  if (waveImageCache.has(cacheKey)) {
    return waveImageCache.get(cacheKey);
  }
  const bars = buildWaveBars(seed, count);
  const step = 4;
  const barWidth = 2;
  const width = Math.max(step, bars.length * step);
  const rects = bars.map((height, index) => {
    const h = Math.max(6, Math.min(96, Number(height) || 18));
    const y = (100 - h) / 2;
    return `<rect x="${index * step}" y="${y}" width="${barWidth}" height="${h}" rx="1" />`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" preserveAspectRatio="none"><g fill="hsl(${hue} 74% 74%)">${rects}</g></svg>`;
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  waveImageCache.set(cacheKey, value);
  return value;
}

function basename(relpath) {
  const value = String(relpath || "");
  return value.split(/[\\/]/).pop() || "";
}

function normalizeTrack(track, kind, index, legacyKey = "") {
  const relpath = String(track?.relpath || "");
  if (!relpath) return null;
  return {
    ...(track || {}),
    id: legacyKey || String(track?.id || `${kind}-${index + 1}`),
    kind,
    label: String(track?.label || basename(relpath).replace(/\.[^.]+$/, "") || `${kind === "music" ? "音乐" : "音效"} ${index + 1}`),
    relpath,
    loop: Boolean(track?.loop ?? true),
    offsetMs: Number(track?.offset_ms ?? 0),
    gainDb: Number(track?.gain_db ?? 0),
  };
}

function collectPostprocessTracks(config = {}) {
  const music = [
    normalizeTrack(config.bgm_track, "music", 0, "legacy-bgm"),
    ...(Array.isArray(config.music_tracks) ? config.music_tracks : []).map((track, index) => normalizeTrack(track, "music", index)),
  ].filter(Boolean);
  const effect = [
    normalizeTrack(config.ambience_track, "effect", 0, "legacy-ambience"),
    ...(Array.isArray(config.effect_tracks) ? config.effect_tracks : []).map((track, index) => normalizeTrack(track, "effect", index)),
  ].filter(Boolean);
  return { music, effect };
}

export default function SegmentTimelinePreview({
  segments = [],
  segmentTimings = {},
  currentTimeMs = 0,
  currentSegmentId = "",
  config = {},
  selectedTrackId = "",
  pendingTrackOffsets = {},
  waveformSync = {},
  onScrollLeftChange,
  onSegmentClick,
  onSegmentTimingChange,
  onTrackSelect,
  onTrackOffsetChange,
}) {
  const scrollerRef = useRef(null);
  const isInternalScrollRef = useRef(false);
  const lastScrollLeftRef = useRef(0);
  const dragCleanupRef = useRef(null);
  const [draggingSegmentTiming, setDraggingSegmentTiming] = useState(null);

  const speakerHueMap = useMemo(() => {
    const map = {};
    let index = 0;
    segments.forEach((segment) => {
      const speaker = String(segment.speaker || "narrator");
      if (!map[speaker]) {
        map[speaker] = SPEAKER_HUES[index % SPEAKER_HUES.length];
        index += 1;
      }
    });
    return map;
  }, [segments]);

  const postprocessTracks = useMemo(() => {
    const collected = collectPostprocessTracks(config);
    const applyPending = (track) => {
      const pending = pendingTrackOffsets?.[track.id];
      if (!pending || !Number.isFinite(Number(pending.offset_ms))) {
        return track;
      }
      return {
        ...track,
        offsetMs: Number(pending.offset_ms),
        pendingOffsetMs: Number(pending.offset_ms),
      };
    };
    return {
      music: collected.music.map(applyPending),
      effect: collected.effect.map(applyPending),
    };
  }, [config, pendingTrackOffsets]);
  const trackOffsetEndMs = useMemo(() => (
    [...postprocessTracks.music, ...postprocessTracks.effect].reduce((maxEnd, track) => (
      Math.max(maxEnd, Math.max(0, Number(track.offsetMs || 0)) + 10_000)
    ), 0)
  ), [postprocessTracks]);

  const timelineEndMs = useMemo(() => {
    const segmentEnd = segments.reduce((maxEnd, segment) => {
      const timing = segmentTimings[segment.segment_id];
      const end = Number(timing?.end);
      return Number.isFinite(end) ? Math.max(maxEnd, end) : maxEnd;
    }, 0);
    const syncEnd = Number(waveformSync?.durationSeconds || 0) * 1000;
    return Math.max(segmentEnd, syncEnd, trackOffsetEndMs, Number(currentTimeMs || 0), 1000);
  }, [currentTimeMs, segmentTimings, segments, trackOffsetEndMs, waveformSync?.durationSeconds]);

  const canvasWidth = Math.max(
    Number(waveformSync?.scrollWidth || 0),
    Number(waveformSync?.clientWidth || 0),
    720,
  );
  const viewportWidth = Math.max(Number(waveformSync?.clientWidth || 0), 1);
  const pxPerMs = canvasWidth / timelineEndMs;
  const playheadLeft = Math.max(0, Math.min(canvasWidth, Number(currentTimeMs || 0) * pxPerMs));
  const tickStepMs = timelineEndMs <= 90_000 ? 10_000 : timelineEndMs <= 240_000 ? 30_000 : 60_000;
  const ticks = useMemo(
    () => Array.from({ length: Math.floor(timelineEndMs / tickStepMs) + 1 }, (_, index) => index * tickStepMs),
    [tickStepMs, timelineEndMs],
  );
  const chapterMarkers = useMemo(() => {
    const markers = Array.isArray(config?.chapter_markers) ? config.chapter_markers : [];
    return markers.map((marker, index) => {
      const segmentId = String(marker?.start_segment_id || "");
      const segmentIndex = segments.findIndex((segment) => String(segment.segment_id || "") === segmentId);
      const timing = segmentTimings[segmentId];
      const start = Number(timing?.start);
      if (!segmentId || !Number.isFinite(start)) {
        return null;
      }
      return {
        id: String(marker?.id || `${segmentId}-${index}`),
        title: String(marker?.title || `章节 ${index + 1}`),
        start,
        segmentIndex,
      };
    }).filter(Boolean);
  }, [config?.chapter_markers, segmentTimings, segments]);
  const audioTrackRows = useMemo(() => [
    { kind: "music", label: "音乐", tracks: postprocessTracks.music },
    { kind: "effect", label: "音效", tracks: postprocessTracks.effect },
  ], [postprocessTracks.effect, postprocessTracks.music]);
  const hasAudioTracks = useMemo(
    () => audioTrackRows.some((row) => row.tracks.length > 0),
    [audioTrackRows],
  );
  const canvasHeight = hasAudioTracks ? 196 : 112;

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const nextLeft = Math.max(0, Number(waveformSync?.scrollLeft || 0));
    if (Math.abs(lastScrollLeftRef.current - nextLeft) <= 1) return;
    isInternalScrollRef.current = true;
    lastScrollLeftRef.current = nextLeft;
    node.scrollLeft = nextLeft;
    requestAnimationFrame(() => {
      isInternalScrollRef.current = false;
    });
  }, [waveformSync?.scrollLeft, canvasWidth]);

  function handleScroll(event) {
    if (isInternalScrollRef.current) return;
    const nextLeft = Number(event.currentTarget.scrollLeft || 0);
    lastScrollLeftRef.current = nextLeft;
    onScrollLeftChange?.(nextLeft);
  }

  function restoreScrollerLeft(left) {
    const node = scrollerRef.current;
    if (!node) return;
    const targetLeft = Math.max(0, Number(left || 0));
    isInternalScrollRef.current = true;
    lastScrollLeftRef.current = targetLeft;
    node.scrollLeft = targetLeft;
    requestAnimationFrame(() => {
      if (scrollerRef.current) {
        lastScrollLeftRef.current = targetLeft;
        scrollerRef.current.scrollLeft = targetLeft;
      }
      isInternalScrollRef.current = false;
    });
  }

  function handleAudioTrackPointerDown(event, kind, track) {
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const startX = Number(event.clientX || 0);
    const startScrollerLeft = Number(scrollerRef.current?.scrollLeft || 0);
    const startOffsetMs = Number(track.offsetMs || 0);
    const trackId = track.id;
    let moved = false;
    let selected = false;

    function selectWithoutMovingTimeline() {
      if (!selected) {
        onTrackSelect?.(kind, trackId);
        selected = true;
      }
      restoreScrollerLeft(startScrollerLeft);
    }

    function handlePointerMove(moveEvent) {
      if (!onTrackOffsetChange || !Number.isFinite(pxPerMs) || pxPerMs <= 0) {
        return;
      }
      const deltaPx = Number(moveEvent.clientX || 0) - startX;
      if (Math.abs(deltaPx) <= 2) {
        return;
      }
      moved = true;
      selectWithoutMovingTimeline();
      const deltaMs = deltaPx / pxPerMs;
      const snappedMs = Math.round((startOffsetMs + deltaMs) / 50) * 50;
      const nextOffsetMs = Math.max(0, Math.min(Math.round(timelineEndMs), snappedMs));
      onTrackOffsetChange(kind, trackId, nextOffsetMs);
    }

    function cleanup(upEvent) {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      dragCleanupRef.current = null;
      if (!moved && upEvent?.type === "pointerup") {
        selectWithoutMovingTimeline();
      }
    }

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  useEffect(() => () => dragCleanupRef.current?.(), []);

  function snapSegmentMs(value) {
    return Math.max(0, Math.round((Number(value) || 0) / SEGMENT_SNAP_MS) * SEGMENT_SNAP_MS);
  }

  function handleSegmentPointerDown(event, segment, baseStart, baseEnd, mode) {
    if (!Number.isFinite(pxPerMs) || pxPerMs <= 0 || !Number.isFinite(baseStart) || !Number.isFinite(baseEnd) || baseEnd <= baseStart) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const segmentId = segment.segment_id;
    const startX = Number(event.clientX || 0);
    const durationMs = Math.max(MIN_SEGMENT_DURATION_MS, baseEnd - baseStart);
    let moved = false;
    let latestStart = baseStart;
    let latestEnd = baseEnd;

    function applyPreview(deltaPx) {
      const deltaMs = deltaPx / pxPerMs;
      if (mode === "start") {
        latestStart = Math.min(baseEnd - MIN_SEGMENT_DURATION_MS, snapSegmentMs(baseStart + deltaMs));
        latestEnd = baseEnd;
      } else if (mode === "end") {
        latestStart = baseStart;
        latestEnd = Math.max(baseStart + MIN_SEGMENT_DURATION_MS, snapSegmentMs(baseEnd + deltaMs));
      } else {
        latestStart = snapSegmentMs(baseStart + deltaMs);
        latestEnd = latestStart + durationMs;
      }
      setDraggingSegmentTiming({ segmentId, start: latestStart, end: latestEnd });
    }

    function handlePointerMove(moveEvent) {
      const deltaPx = Number(moveEvent.clientX || 0) - startX;
      if (Math.abs(deltaPx) > 2) {
        moved = true;
      }
      applyPreview(deltaPx);
    }

    function cleanup(upEvent) {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      dragCleanupRef.current = null;
      setDraggingSegmentTiming(null);
      if (moved) {
        onSegmentTimingChange?.(segmentId, latestStart, latestEnd);
      } else if (upEvent?.type === "pointerup") {
        onSegmentClick?.(segment);
      }
    }

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  return (
    <div className="segmentTimelinePreview" aria-label="片段时间线预览">
      <div
        ref={scrollerRef}
        className="segmentTimelinePreviewScroller"
        style={{ "--segment-preview-viewport-width": `${viewportWidth}px` }}
        onScroll={handleScroll}
      >
        <div className="segmentTimelinePreviewCanvas" style={{ width: canvasWidth, height: canvasHeight }}>
          <div className="segmentTimelinePreviewRuler" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="segmentTimelinePreviewTick"
                style={{ left: `${Math.min(canvasWidth, tick * pxPerMs)}px` }}
              >
                {formatTickTime(tick)}
              </span>
            ))}
          </div>
          {chapterMarkers.length ? (
            <div className="segmentTimelineChapterLayer" aria-label="章节标识">
              {chapterMarkers.map((marker) => (
                <span
                  key={marker.id}
                  className="segmentTimelineChapterMarker"
                  style={{ left: `${Math.min(canvasWidth, marker.start * pxPerMs)}px` }}
                  title={`${marker.title}${marker.segmentIndex >= 0 ? ` · #${marker.segmentIndex + 1}` : ""} · ${formatTickTime(marker.start)}`}
                >
                  <span className="segmentTimelineChapterMarkerLabel">{marker.title}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="segmentTimelinePreviewLane segmentTimelinePreviewSegmentLane">
            {segments.map((segment, index) => {
              const timing = segmentTimings[segment.segment_id];
              const dragTiming = draggingSegmentTiming?.segmentId === segment.segment_id ? draggingSegmentTiming : null;
              const start = Number(dragTiming?.start ?? timing?.start);
              const end = Number(dragTiming?.end ?? timing?.end);
              const hasTiming = Number.isFinite(start) && Number.isFinite(end) && end > start;
              const left = hasTiming ? Math.max(0, start * pxPerMs) : 0;
              const width = hasTiming ? Math.max(18, (end - start) * pxPerMs) : Math.max(36, canvasWidth / Math.max(segments.length, 1));
              const hue = speakerHueMap[String(segment.speaker || "narrator")] || SPEAKER_HUES[index % SPEAKER_HUES.length];
              const label = `${segment.speaker || "narrator"}${segment.type === "dialogue" ? "" : ` (${segment.type || ""})`}`;
              const waveImage = buildWaveImage(hashString(`${segment.segment_id}:${segment.text}:${segment.speaker}`), 32, hue);
              return (
                <span
                  role="button"
                  tabIndex={hasTiming ? 0 : -1}
                  key={segment.segment_id}
                  className={`segmentTimelinePreviewBlock ${currentSegmentId === segment.segment_id ? "active" : ""} ${dragTiming ? "dragging" : ""} ${hasTiming ? "" : "muted"}`}
                  style={{
                    left,
                    width,
                    "--segment-hue": hue,
                  }}
                  title={hasTiming ? `${label} ${formatTickTime(start)} - ${formatTickTime(end)}` : `${label} 缺少时间位置`}
                  aria-disabled={!hasTiming}
                  onPointerDown={(event) => hasTiming ? handleSegmentPointerDown(event, segment, start, end, "move") : undefined}
                  onKeyDown={(event) => {
                    if (!hasTiming) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSegmentClick?.(segment);
                    }
                  }}
                >
                  <i
                    className="segmentTimelinePreviewResizeHandle left"
                    aria-hidden="true"
                    onPointerDown={(event) => handleSegmentPointerDown(event, segment, start, end, "start")}
                  />
                  <span className="segmentTimelinePreviewLabel">{label}</span>
                  <span className="segmentTimelinePreviewWave" style={{ backgroundImage: waveImage }} aria-hidden="true" />
                  <i
                    className="segmentTimelinePreviewResizeHandle right"
                    aria-hidden="true"
                    onPointerDown={(event) => handleSegmentPointerDown(event, segment, start, end, "end")}
                  />
                </span>
              );
            })}
            <span className="segmentTimelinePreviewPlayhead" style={{ left: playheadLeft }} aria-hidden="true" />
          </div>
          {hasAudioTracks ? (
            <div className="segmentTimelineAudioTracks" aria-label="音乐和音效时间轨道">
              {audioTrackRows.map((row, rowIndex) => (
                <div
                  key={row.kind}
                  className={`segmentTimelineAudioLane ${row.kind}`}
                  style={{ top: 112 + rowIndex * 40 }}
                >
                  <span className="segmentTimelineAudioLaneLabel">{row.label}</span>
                  {row.tracks.length ? row.tracks.map((track, index) => {
                    const hasPendingOffset = Number.isFinite(Number(track.pendingOffsetMs));
                    const startMs = Math.max(0, Number(track.offsetMs || 0));
                    const left = Math.max(0, startMs * pxPerMs);
                    const fallbackDurationMs = track.loop
                      ? Math.max(2000, timelineEndMs - startMs)
                      : Math.max(4500, Math.min(18_000, timelineEndMs * 0.24));
                    const width = Math.max(52, Math.min(canvasWidth - left, fallbackDurationMs * pxPerMs));
                    const hue = row.kind === "music" ? 38 : 188;
                    const waveImage = buildWaveImage(hashString(`${track.id}:${track.relpath}:${track.label}`), 28, hue);
                    return (
                      <span
                        key={track.id || `${row.kind}-${index}`}
                        className={`segmentTimelineAudioBlock ${track.loop ? "loop" : ""} ${selectedTrackId === track.id ? "selected" : ""} ${hasPendingOffset ? "pending" : ""}`}
                        style={{ left, width, "--segment-hue": hue }}
                        title={`${track.label} · ${formatTickTime(startMs)} · ${track.gainDb > 0 ? "+" : ""}${track.gainDb} dB${track.loop ? " · 循环" : ""} · 拖动调整位置`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedTrackId === track.id}
                        onPointerDown={(event) => handleAudioTrackPointerDown(event, row.kind, track)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onTrackSelect?.(row.kind, track.id);
                          }
                        }}
                      >
                        <strong>{track.label}</strong>
                        <span className="segmentTimelineAudioWave" style={{ backgroundImage: waveImage }} aria-hidden="true" />
                      </span>
                    );
                  }) : <span className="segmentTimelineAudioEmpty">未添加</span>}
                </div>
              ))}
              <span className="segmentTimelinePreviewPlayhead segmentTimelineAudioPlayhead" style={{ left: playheadLeft }} aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
