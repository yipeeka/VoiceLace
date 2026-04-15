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

function pickWaveformLevel(zoom) {
  if (zoom >= 50) return 4096;
  return 2048;
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

export default function SynthesisWaveSurfer({ projectId, audioUrl, segments = [], gapDurationMs = 500, height = 100 }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [waveformPayload, setWaveformPayload] = useState({ data: [], duration_ms: 0, level: 1024 });
  const [waveformError, setWaveformError] = useState("");

  const requestedLevel = useMemo(() => pickWaveformLevel(zoom), [zoom]);

  useEffect(() => {
    let canceled = false;

    async function loadWaveformPeaks() {
      if (!projectId || !audioUrl) {
        setWaveformPayload({ data: [], duration_ms: 0, level: requestedLevel });
        return;
      }
      try {
        const payload = await api.get(`/tts/projects/${projectId}/waveform?level=${requestedLevel}`);
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
  }, [projectId, audioUrl, requestedLevel]);

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
      if (!speakerColors[seg.speaker]) {
        speakerColors[seg.speaker] = colors[colorIndex % colors.length];
        colorIndex += 1;
      }
      const config = {
        id: seg.segment_id || `region-${idx}`,
        start: cursor,
        end: cursor + dur,
        content: document.createTextNode(`${seg.speaker}`),
        color: speakerColors[seg.speaker] || defaultColor,
        drag: false,
        resize: false,
        text: seg.text,
      };
      cursor += dur + gapDurationMs / 1000;
      return config;
    });
  }, [segments, gapDurationMs]);

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

      if (precomputedChannelData && precomputedDurationSec) {
        ws.load(audioUrl, [precomputedChannelData], precomputedDurationSec);
      } else {
        ws.load(audioUrl);
      }
    } catch {
      return undefined;
    }

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsReady(true);
      setWaveformError("");
      regionConfig.forEach((config) => {
        const region = regionsPlugin.addRegion(config);
        const contentEl = region.element.querySelector(".wavesurfer-region-content");
        if (contentEl) {
          contentEl.style.fontSize = "11px";
          contentEl.style.padding = "2px 4px";
          contentEl.style.color = "var(--text-secondary)";
          contentEl.style.whiteSpace = "nowrap";
          contentEl.style.overflow = "hidden";
          contentEl.style.textOverflow = "ellipsis";
          contentEl.title = config.text;
        }
      });
    });

    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("error", (err) => {
      const message = String(err?.message || err || "").toLowerCase();
      if (message.includes("abort") || message.includes("destroy")) {
        return;
      }
      setWaveformError("WaveSurfer 初始化失败，建议重试或刷新页面。");
    });

    wavesurferRef.current = ws;

    return () => {
      ws?.destroy();
      wavesurferRef.current = null;
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [audioUrl, regionConfig, height, precomputedChannelData, precomputedDurationSec]);

  useEffect(() => {
    if (!wavesurferRef.current || !isReady) return;
    if (zoom === 0) {
      wavesurferRef.current.zoom(1);
    } else {
      wavesurferRef.current.zoom(10 + zoom * 3);
    }
  }, [zoom, isReady]);

  const togglePlay = async () => {
    if (!wavesurferRef.current || !isReady) return;
    await wavesurferRef.current.playPause();
    setIsPlaying((v) => !v);
  };

  if (!audioUrl) return null;

  return (
    <div className="synthesisWaveformShell" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={togglePlay}
          disabled={!isReady}
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
          {isPlaying ? <Pause size={17} /> : <Play size={17} style={{ marginLeft: 1 }} />}
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
          <ZoomOut size={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Slider
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={0}
              max={100}
              step={1}
              disabled={!isReady}
              hideValue
            />
          </div>
          <ZoomIn size={14} />
        </div>
      </div>

      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        <div ref={containerRef} style={{ width: "100%" }} />
      </div>

      {waveformError ? (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{waveformError}</div>
      ) : null}
    </div>
  );
}
