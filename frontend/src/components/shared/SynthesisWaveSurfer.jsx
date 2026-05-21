import { Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";

import { api } from "../../utils/api";
import Slider from "../ui/Slider";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeZoomValue(zoom) {
  return Math.max(0, Math.min(1, Number(zoom || 0) / 100));
}

function mapZoomToPixelsPerSecond(zoom) {
  const t = normalizeZoomValue(zoom);
  if (t <= 0) return 1;
  // Smoothstep gives gentler low-end movement while keeping the far end usable.
  const eased = t * t * (3 - 2 * t);
  return 1 + eased * 120;
}

function pickWaveformLevel(zoom) {
  const t = normalizeZoomValue(zoom);
  if (t >= 0.75) return 4096;
  if (t >= 0.3) return 2048;
  return 1024;
}

function buildChannelDataFromMinMax(data) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const samples = Math.floor(data.length / 2);
  if (!samples) return null;
  const channel = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const min = Number(data[i * 2]) / 32768;
    const max = Number(data[i * 2 + 1]) / 32768;
    const amp = Math.max(Math.abs(Number.isFinite(min) ? min : 0), Math.abs(Number.isFinite(max) ? max : 0));
    channel[i] = Math.max(0, Math.min(1, amp));
  }
  return channel;
}

export default function SynthesisWaveSurfer({
  projectId,
  audioUrl,
  audioVariant = "raw",
  segments = [],
  gapDurationMs = 300,
  useSourceTimeline = false,
  height = 100,
  onCurrentTimeChange = null,
  autoPlaySignal = 0,
  pauseSignal = 0,
  seekToSeconds = null,
  seekSignal = 0,
  playOnSeek = false,
  onPlayStateChange = null,
  onDurationChange = null,
  onWaveformSyncChange = null,
  externalScrollLeft = 0,
  externalScrollSignal = 0,
  children = null,
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionWarningLoggedRef = useRef(false);
  const readyRef = useRef(false);
  const onDurationChangeRef = useRef(onDurationChange);
  const onWaveformSyncChangeRef = useRef(onWaveformSyncChange);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [waveformPayload, setWaveformPayload] = useState({ data: [], duration_ms: 0, level: 1024 });
  const [waveformError, setWaveformError] = useState("");
  const [forcePlainLoad, setForcePlainLoad] = useState(false);

  useEffect(() => {
    onDurationChangeRef.current = onDurationChange;
  }, [onDurationChange]);

  useEffect(() => {
    onWaveformSyncChangeRef.current = onWaveformSyncChange;
  }, [onWaveformSyncChange]);

  function emitWaveformSync(ws) {
    if (!ws || typeof onWaveformSyncChangeRef.current !== "function") return;
    const durationSeconds = Number(ws.getDuration?.() || 0);
    const wrapper = ws.getWrapper?.();
    const scrollContainer = wrapper?.parentElement || null;
    const scrollWidth = Math.max(
      Number(wrapper?.scrollWidth || 0),
      Number(scrollContainer?.scrollWidth || 0),
    );
    const clientWidth = Math.max(
      Number(scrollContainer?.clientWidth || 0),
      Number(wrapper?.clientWidth || 0),
    );
    const scrollLeft = Number.isFinite(Number(ws.getScroll?.()))
      ? Number(ws.getScroll())
      : Number(scrollContainer?.scrollLeft || 0);
    onWaveformSyncChangeRef.current({
      durationSeconds,
      scrollLeft: Math.max(0, scrollLeft),
      scrollWidth,
      clientWidth,
      pixelsPerSecond: durationSeconds > 0 && scrollWidth > 0 ? scrollWidth / durationSeconds : 0,
    });
  }

  useEffect(() => {
    if (typeof onCurrentTimeChange === "function") {
      onCurrentTimeChange(currentTime);
    }
  }, [currentTime, onCurrentTimeChange]);

  useEffect(() => {
    onPlayStateChange?.(isPlaying);
  }, [isPlaying, onPlayStateChange]);

  const requestedLevel = useMemo(() => pickWaveformLevel(zoom), [zoom]);

  useEffect(() => {
    setForcePlainLoad(false);
    regionWarningLoggedRef.current = false;
    readyRef.current = false;
  }, [projectId, audioUrl]);

  useEffect(() => {
    let canceled = false;

    async function loadWaveformPeaks() {
      if (!projectId || !audioUrl) {
        setWaveformPayload({ data: [], duration_ms: 0, level: requestedLevel });
        return;
      }
      try {
        const payload = await api.get(`/tts/projects/${projectId}/waveform?level=${requestedLevel}&variant=${audioVariant}`);
        if (canceled) return;
        setWaveformError("");
        setWaveformPayload({
          data: Array.isArray(payload.data) ? payload.data : [],
          duration_ms: Number(payload.duration_ms || 0),
          level: Number(payload.level || requestedLevel),
        });
      } catch {
        if (canceled) return;
        setWaveformError("完整波形 peaks 加载失败，已降级为普通波形加载。");
        setWaveformPayload({ data: [], duration_ms: 0, level: requestedLevel });
      }
    }

    loadWaveformPeaks();
    return () => {
      canceled = true;
    };
  }, [projectId, audioUrl, requestedLevel, audioVariant]);

  const regionConfig = useMemo(() => {
    const defaultColor = "rgba(100, 100, 100, 0.1)";
    const colors = [
      "rgba(59, 130, 246, 0.2)",
      "rgba(16, 185, 129, 0.2)",
      "rgba(245, 158, 11, 0.2)",
      "rgba(236, 72, 153, 0.2)",
      "rgba(139, 92, 246, 0.2)",
    ];

    let cursor = 0;
    const speakerColors = {};
    let colorIndex = 0;

    return segments.map((seg, idx) => {
      const dur = (seg.duration_ms || 2000) / 1000;
      const sourceStartMs = Number(seg.source_start_ms);
      const sourceEndMs = Number(seg.source_end_ms);
      const hasSourceTiming =
        useSourceTimeline &&
        Number.isFinite(sourceStartMs) &&
        Number.isFinite(sourceEndMs) &&
        sourceStartMs >= 0 &&
        sourceEndMs > sourceStartMs;
      let start = cursor;
      let end = start + dur;
      if (hasSourceTiming) {
        start = sourceStartMs / 1000;
        end = sourceEndMs / 1000;
      } else if (useSourceTimeline && Number.isFinite(sourceStartMs) && sourceStartMs >= 0) {
        start = sourceStartMs / 1000;
        end = start + dur;
      }
      if (!speakerColors[seg.speaker]) {
        speakerColors[seg.speaker] = colors[colorIndex % colors.length];
        colorIndex += 1;
      }
      const config = {
        id: seg.segment_id || `region-${idx}`,
        start,
        end,
        content: document.createTextNode(`${seg.speaker}`),
        color: speakerColors[seg.speaker] || defaultColor,
        drag: false,
        resize: false,
        text: seg.text,
      };
      cursor = useSourceTimeline ? Math.max(cursor, end) : end + gapDurationMs / 1000;
      return config;
    });
  }, [segments, gapDurationMs, useSourceTimeline]);

  const precomputedChannelData = useMemo(
    () => buildChannelDataFromMinMax(waveformPayload.data),
    [waveformPayload.data],
  );
  const precomputedDurationSec = useMemo(() => {
    const value = Number(waveformPayload.duration_ms || 0);
    return value > 0 ? value / 1000 : undefined;
  }, [waveformPayload.duration_ms]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return undefined;

    let ws = null;
    let regionsPlugin = null;
    let disposed = false;

    try {
      regionsPlugin = RegionsPlugin.create();
      ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(161, 161, 170, 0.4)",
        progressColor: "var(--accent-primary)",
        cursorColor: "var(--accent-secondary)",
        hideScrollbar: false,
        height,
        barWidth: 1.2,
        barGap: 0,
        barRadius: 2,
        normalize: true,
        plugins: [
          TimelinePlugin.create({
            height: 24,
            timeInterval: 5,
            primaryLabelInterval: 10,
            style: {
              fontSize: "10px",
              color: "var(--text-muted)",
              fontFamily: "monospace",
              borderTop: "1px solid var(--border-default)",
              background: "var(--bg-default)",
              paddingTop: "2px",
            },
          }),
          regionsPlugin,
        ],
      });

      const loadPromise = !forcePlainLoad && precomputedChannelData && precomputedDurationSec
        ? ws.load(audioUrl, [precomputedChannelData], precomputedDurationSec)
        : ws.load(audioUrl);
      if (loadPromise && typeof loadPromise.catch === "function") {
        loadPromise.catch((err) => {
          if (disposed) {
            return;
          }
          const message = String(err?.message || err || "").toLowerCase();
          if (message.includes("abort") || message.includes("destroy")) {
            return;
          }
          setWaveformError("WaveSurfer 初始化失败，建议重试或刷新页面。");
        });
      }
    } catch {
      return undefined;
    }

    ws.on("ready", () => {
      if (disposed) return;
      const nextDuration = ws.getDuration();
      setDuration(nextDuration);
      onDurationChangeRef.current?.(nextDuration);
      setIsReady(true);
      readyRef.current = true;
      setWaveformError("");
      requestAnimationFrame(() => emitWaveformSync(ws));

      // Regions are decorative only. If region rendering fails, do not block playback.
      regionConfig.forEach((config) => {
        try {
          const region = regionsPlugin.addRegion(config);
          const contentEl = region.element?.querySelector?.(".wavesurfer-region-content");
          if (contentEl) {
            contentEl.style.fontSize = "11px";
            contentEl.style.padding = "2px 4px";
            contentEl.style.color = "var(--text-secondary)";
            contentEl.style.whiteSpace = "nowrap";
            contentEl.style.overflow = "hidden";
            contentEl.style.textOverflow = "ellipsis";
            contentEl.title = config.text;
          }
        } catch (error) {
          if (import.meta?.env?.DEV && !regionWarningLoggedRef.current) {
            regionWarningLoggedRef.current = true;
            // Non-blocking diagnostics in development only.
            console.warn("[SynthesisWaveSurfer] region render failed; playback kept available.", error);
          }
        }
      });
    });

    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("scroll", () => emitWaveformSync(ws));
    ws.on("zoom", () => requestAnimationFrame(() => emitWaveformSync(ws)));
    ws.on("redrawcomplete", () => emitWaveformSync(ws));
    ws.on("resize", () => emitWaveformSync(ws));
    ws.on("error", (err) => {
      if (disposed) return;
      const message = String(err?.message || err || "").toLowerCase();
      if (message.includes("abort") || message.includes("destroy")) {
        return;
      }
      const alreadyReady = readyRef.current || ws.getDuration() > 0;
      if (alreadyReady) {
        // Keep playback path available when waveform/region internals throw transient errors.
        setWaveformError("完整音频波形渲染异常，已保留音频播放。");
        return;
      }
      if (!forcePlainLoad && precomputedChannelData && precomputedDurationSec) {
        setForcePlainLoad(true);
        setWaveformError("波形预加载失败，已自动切换普通模式。");
        return;
      }
      setWaveformError("WaveSurfer 初始化失败，建议重试或刷新页面。");
    });

    wavesurferRef.current = ws;

    return () => {
      disposed = true;
      try {
        const destroyed = ws?.destroy();
        if (destroyed && typeof destroyed.catch === "function") {
          destroyed.catch(() => undefined);
        }
      } catch {
        // Destroy can throw during hot reload or aborted media loads; teardown should stay non-blocking.
      }
      wavesurferRef.current = null;
      readyRef.current = false;
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [audioUrl, regionConfig, height, precomputedChannelData, precomputedDurationSec, forcePlainLoad]);

  useEffect(() => {
    if (!wavesurferRef.current || !isReady) return;
    try {
      wavesurferRef.current.zoom(mapZoomToPixelsPerSecond(zoom));
      requestAnimationFrame(() => emitWaveformSync(wavesurferRef.current));
    } catch {
      setWaveformError("缩放失败，已保持当前波形视图。");
    }
  }, [zoom, isReady]);

  useEffect(() => {
    if (!externalScrollSignal || !wavesurferRef.current || !isReady) return;
    const nextScrollLeft = Math.max(0, Number(externalScrollLeft || 0));
    try {
      const currentScrollLeft = Number(wavesurferRef.current.getScroll?.() || 0);
      if (Math.abs(currentScrollLeft - nextScrollLeft) > 1) {
        wavesurferRef.current.setScroll(nextScrollLeft);
      }
      requestAnimationFrame(() => emitWaveformSync(wavesurferRef.current));
    } catch {
      setWaveformError("同步滚动失败，已保持当前波形视图。");
    }
  }, [externalScrollLeft, externalScrollSignal, isReady]);

  const togglePlay = async () => {
    if (!wavesurferRef.current || !isReady) return;
    try {
      await wavesurferRef.current.playPause();
    } catch {
      setIsPlaying(false);
      setIsReady(false);
      setWaveformError("音频尚未就绪，请稍后重试。");
    }
  };

  useEffect(() => {
    if (!autoPlaySignal || !wavesurferRef.current || !isReady) {
      return;
    }
    wavesurferRef.current.play().catch(() => {
      setIsPlaying(false);
      setWaveformError("音频尚未就绪，请稍后重试。");
    });
  }, [autoPlaySignal, isReady]);

  useEffect(() => {
    if (!pauseSignal || !wavesurferRef.current || !isReady) {
      return;
    }
    wavesurferRef.current.pause();
  }, [pauseSignal, isReady]);

  useEffect(() => {
    if (!seekSignal || !wavesurferRef.current || !isReady) {
      return;
    }
    const rawSeconds = Number(seekToSeconds);
    if (!Number.isFinite(rawSeconds)) {
      return;
    }
    const nextTime = duration > 0
      ? Math.max(0, Math.min(duration, rawSeconds))
      : Math.max(0, rawSeconds);
    try {
      if (typeof wavesurferRef.current.setTime === "function") {
        wavesurferRef.current.setTime(nextTime);
      } else if (duration > 0) {
        wavesurferRef.current.seekTo(nextTime / duration);
      }
      setCurrentTime(nextTime);
      if (playOnSeek) {
        wavesurferRef.current.play().catch(() => {
          setIsPlaying(false);
          setWaveformError("音频尚未就绪，请稍后重试。");
        });
      }
    } catch {
      setWaveformError("定位音频失败，请稍后重试。");
    }
  }, [seekSignal, seekToSeconds, playOnSeek, isReady, duration]);

  if (!audioUrl) return null;

  return (
    <div className={`synthesisWaveformShell ${children ? "hasSyncedArrangement" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!isReady}
          aria-label={isPlaying ? "暂停完整音频" : "播放完整音频"}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: isReady ? "var(--accent-primary)" : "var(--bg-soft)",
            border: "none",
            color: isReady ? "var(--text-inverse)" : "var(--text-muted)",
            cursor: isReady ? "pointer" : "default",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            transition: "background var(--duration-fast) ease",
          }}
        >
          {isPlaying ? <Pause aria-hidden="true" focusable="false" size={17} /> : <Play aria-hidden="true" focusable="false" size={17} style={{ marginLeft: 1 }} />}
        </button>

        <span
          style={{
            color: "var(--text-muted)",
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", width: 260, color: "var(--text-muted)" }}>
          <ZoomOut aria-hidden="true" focusable="false" size={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Slider
              ariaLabel="完整波形缩放"
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={0}
              max={100}
              step={0.5}
              disabled={!isReady}
              hideValue
            />
          </div>
          <ZoomIn aria-hidden="true" focusable="false" size={14} />
        </div>
      </div>

      <div className="synthesisWaveformUnifiedViewport">
        <div className="synthesisWaveformViewport">
          <div ref={containerRef} style={{ width: "100%" }} />
        </div>
        {children ? (
          <div className="synthesisWaveformArrangementSlot">
            {children}
          </div>
        ) : null}
      </div>

      {waveformError ? (
        <div
          style={{
            color: waveformError.includes("暂不可用") ? "var(--text-subtle)" : "var(--text-muted)",
            fontSize: 12,
          }}
        >
          {waveformError}
        </div>
      ) : null}
    </div>
  );
}
