import { Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { API_ORIGIN } from "../../utils/api";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const peaksCache = new Map();

function normalizePeaksData(peaks) {
  if (!peaks || !Array.isArray(peaks.data) || peaks.data.length < 2) {
    return [];
  }
  const data = peaks.data;
  const bars = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    const min = Number(data[i]) / 32768;
    const max = Number(data[i + 1]) / 32768;
    bars.push({
      min: Number.isFinite(min) ? Math.max(-1, Math.min(1, min)) : 0,
      max: Number.isFinite(max) ? Math.max(-1, Math.min(1, max)) : 0,
    });
  }
  return bars;
}

function resolveUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_ORIGIN}${path}`;
}

export default function AudioPlayer({ audioUrl, peaks = null, peaksUrl = null, height = 60, compact = false }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [resolvedPeaks, setResolvedPeaks] = useState(peaks || null);

  useEffect(() => {
    setResolvedPeaks(peaks || null);
  }, [peaks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onCanPlay = () => {
      setIsReady(true);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [audioUrl]);

  useEffect(() => {
    let canceled = false;
    async function loadPeaks() {
      if (!peaksUrl || resolvedPeaks) {
        return;
      }
      const url = resolveUrl(peaksUrl);
      if (!url) return;
      if (peaksCache.has(url)) {
        setResolvedPeaks(peaksCache.get(url));
        return;
      }
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const payload = await response.json();
        const normalized = {
          format: payload.format || "minmax_i16",
          bins: Number(payload.level || payload.bins || 0),
          data: Array.isArray(payload.data) ? payload.data : [],
        };
        if (!canceled) {
          peaksCache.set(url, normalized);
          setResolvedPeaks(normalized);
        }
      } catch {
        // Silent fallback: keep player usable without waveform peaks.
      }
    }
    loadPeaks();
    return () => {
      canceled = true;
    };
  }, [peaksUrl, resolvedPeaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = canvas.clientHeight || height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cssWidth * ratio));
    canvas.height = Math.max(1, Math.floor(cssHeight * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "rgba(161, 161, 170, 0.16)";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const bars = normalizePeaksData(resolvedPeaks);
    if (!bars.length) {
      ctx.strokeStyle = "rgba(161, 161, 170, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cssHeight / 2);
      ctx.lineTo(cssWidth, cssHeight / 2);
      ctx.stroke();
      return;
    }

    const progressRatio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
    const progressX = cssWidth * progressRatio;
    const mid = cssHeight / 2;
    const barWidth = compact ? 2 : 2.5;
    const barGap = compact ? 1 : 1.5;
    const step = barWidth + barGap;
    const visibleBars = Math.max(1, Math.floor(cssWidth / step));
    const stride = Math.max(1, Math.floor(bars.length / visibleBars));
    let x = 0;

    for (let i = 0; i < bars.length && x < cssWidth; i += stride) {
      const item = bars[i];
      const minY = mid + item.min * mid * 0.92;
      const maxY = mid + item.max * mid * 0.92;
      const top = Math.min(minY, maxY);
      const bottom = Math.max(minY, maxY);
      const h = Math.max(1, bottom - top);
      ctx.fillStyle = x <= progressX ? "rgba(92, 211, 255, 0.95)" : "rgba(161, 161, 170, 0.55)";
      ctx.fillRect(x, top, barWidth, h);
      x += step;
    }
  }, [resolvedPeaks, currentTime, duration, height, compact]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }
    audio.pause();
    setIsPlaying(false);
  };

  if (!audioUrl) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 14,
        width: "100%",
        background: "var(--bg-elevated)",
        padding: compact ? "8px 10px" : "10px 14px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-default)",
      }}
    >
      <button
        onClick={togglePlay}
        disabled={!isReady}
        style={{
          width: compact ? 32 : 38,
          height: compact ? 32 : 38,
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
        {isPlaying ? (
          <Pause size={compact ? 14 : 17} />
        ) : (
          <Play size={compact ? 14 : 17} style={{ marginLeft: 1 }} />
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height,
            borderRadius: 8,
            cursor: isReady ? "pointer" : "default",
          }}
          onClick={(event) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            audio.currentTime = Math.max(0, Math.min(duration, duration * ratio));
            setCurrentTime(audio.currentTime || 0);
          }}
        />
      </div>

      <span
        style={{
          color: "var(--text-muted)",
          fontSize: compact ? 11 : 12,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "'JetBrains Mono', monospace",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {!compact && (
        <Volume2 size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      )}
      <audio ref={audioRef} src={audioUrl} preload="metadata" style={{ display: "none" }} />
    </div>
  );
}
