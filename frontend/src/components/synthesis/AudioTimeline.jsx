import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useI18n } from "../../i18n/I18nProvider";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildTimeline(segments, gapDurationMs) {
  const items = [];
  let cursorMs = 0;
  for (const segment of segments) {
    const durationMs = Number(segment.duration_ms || 0);
    const startMs = cursorMs;
    const endMs = startMs + durationMs;
    items.push({
      ...segment,
      durationMs,
      startMs,
      endMs,
    });
    cursorMs = endMs + gapDurationMs;
  }
  return { items, totalMs: Math.max(1, cursorMs - gapDurationMs) };
}

export default function AudioTimeline({ audioUrl, segments, gapDurationMs = 300, onActiveSegmentChange, focusSegmentId }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoomPxPerSec, setZoomPxPerSec] = useState(30);

  const { items, totalMs } = useMemo(() => buildTimeline(segments, gapDurationMs), [segments, gapDurationMs]);
  const activeIndex = useMemo(() => {
    const nowMs = currentTime * 1000;
    return items.findIndex((item) => nowMs >= item.startMs && nowMs <= item.endMs);
  }, [items, currentTime]);

  useEffect(() => {
    if (!onActiveSegmentChange) {
      return;
    }
    onActiveSegmentChange(activeIndex >= 0 ? items[activeIndex]?.segment_id || null : null);
  }, [activeIndex, items, onActiveSegmentChange]);

  useEffect(() => {
    if (!focusSegmentId || !items.length) {
      return;
    }
    const target = items.find((item) => item.segment_id === focusSegmentId);
    if (target) {
      seekToSegment(target.startMs);
    }
  }, [focusSegmentId, items, duration]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) {
      return undefined;
    }
    setIsReady(false);
    setLoadError("");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#7aa2ff",
      progressColor: "#ffd166",
      cursorColor: "#f8fafc",
      height: 92,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });

    ws.load(audioUrl);
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsReady(true);
      setLoadError("");
    });
    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("seek", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("error", () => {
      setIsReady(false);
      setIsPlaying(false);
      setLoadError(t("synth.audioTimeline.loadFailed"));
    });
    wavesurferRef.current = ws;
    return () => {
      wavesurferRef.current = null;
      ws.destroy();
    };
  }, [audioUrl]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) {
      return;
    }
    try {
      ws.zoom(zoomPxPerSec);
    } catch {
      setLoadError(t("synth.audioTimeline.notReady"));
    }
  }, [zoomPxPerSec, isReady]);

  function togglePlay() {
    if (!isReady || !wavesurferRef.current) {
      return;
    }
    try {
      wavesurferRef.current.playPause();
      setIsPlaying((prev) => !prev);
    } catch {
      setIsPlaying(false);
      setLoadError(t("synth.audioTimeline.notReady"));
    }
  }

  function seekToSegment(startMs) {
    const ws = wavesurferRef.current;
    if (!ws || !duration) {
      return;
    }
    const fraction = Math.max(0, Math.min(1, (startMs / 1000) / duration));
    try {
      ws.seekTo(fraction);
    } catch {
      setLoadError(t("synth.audioTimeline.notReady"));
    }
  }

  function seekByOffset(offset) {
    if (!items.length) {
      return;
    }
    const base = activeIndex < 0 ? 0 : activeIndex;
    const targetIndex = Math.max(0, Math.min(items.length - 1, base + offset));
    seekToSegment(items[targetIndex].startMs);
  }

  function seekByPercent(percent) {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) {
      return;
    }
    try {
      ws.seekTo(Math.max(0, Math.min(1, percent)));
    } catch {
      setLoadError(t("synth.audioTimeline.notReady"));
    }
  }

  if (!audioUrl) {
    return <div className="emptyState">{t("synth.audioTimeline.empty")}</div>;
  }

  return (
    <div className="audioTimelineCard">
      <div className="timelineHeader">
        <button type="button" className="timelinePlayButton" onClick={togglePlay} disabled={!isReady}>
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className="timelineJumpButton" onClick={() => seekByOffset(-1)} disabled={!items.length || !isReady}>
          {t("synth.audioTimeline.prev")}
        </button>
        <button type="button" className="timelineJumpButton" onClick={() => seekByOffset(1)} disabled={!items.length || !isReady}>
          {t("synth.audioTimeline.next")}
        </button>
        <span className="muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="timelineZoomRow">
        <span className="muted">{t("synth.audioTimeline.zoom")}</span>
        <input
          className="timelineZoomSlider"
          type="range"
          min={10}
          max={180}
          step={5}
          value={zoomPxPerSec}
          onChange={(event) => setZoomPxPerSec(Number(event.target.value))}
        />
        <span className="muted">{zoomPxPerSec}px/s</span>
      </div>
      <div ref={containerRef} className="timelineWave" />
      {loadError ? <div className="errorText">{loadError}</div> : null}
      <div
        className="timelineMiniMap"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const percent = rect.width > 0 ? x / rect.width : 0;
          seekByPercent(percent);
        }}
      >
        <div className="timelineMiniMapProgress" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
        {items.map((item) => {
          const left = `${(item.startMs / totalMs) * 100}%`;
          return <div key={item.segment_id} className="timelineMiniMapTick" style={{ left }} />;
        })}
      </div>
      <div className="timelineRuler">
        {items.map((item) => {
          const width = `${Math.max(2, (item.durationMs / totalMs) * 100)}%`;
          const left = `${(item.startMs / totalMs) * 100}%`;
          return (
            <button
              key={item.segment_id}
              type="button"
              className={`timelineSegment ${activeIndex >= 0 && items[activeIndex].segment_id === item.segment_id ? "active" : ""}`}
              style={{ left, width }}
              title={`#${item.index + 1} ${item.speaker} (${(item.durationMs / 1000).toFixed(2)}s)`}
              onClick={() => seekToSegment(item.startMs)}
            />
          );
        })}
      </div>
      <div className="timelineLegend">
        {items.map((item) => (
          <button
            key={item.segment_id}
            type="button"
            className={`timelineLegendItem ${activeIndex >= 0 && items[activeIndex].segment_id === item.segment_id ? "active" : ""}`}
            onClick={() => seekToSegment(item.startMs)}
          >
            #{item.index + 1} {item.speaker} · {(item.durationMs / 1000).toFixed(2)}s
          </button>
        ))}
      </div>
    </div>
  );
}
