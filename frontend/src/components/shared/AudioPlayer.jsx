import { Pause, Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { API_ORIGIN } from "../../utils/api";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const peaksCache = new Map();
const decodedPeaksCache = new Map();

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

function extractPeaksData(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data) && payload.data.length) return payload.data;
  const levels = payload.levels;
  if (!levels || typeof levels !== "object") return [];
  const preferredKey = String(payload.bins || payload.level || "");
  if (preferredKey && Array.isArray(levels[preferredKey]) && levels[preferredKey].length) {
    return levels[preferredKey];
  }
  const firstKey = Object.keys(levels)[0];
  if (firstKey && Array.isArray(levels[firstKey])) {
    return levels[firstKey];
  }
  return [];
}

function resolveUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_ORIGIN}${path}`;
}

async function buildPeaksFromAudioUrl(audioUrl, bins = 320) {
  if (!audioUrl) return null;
  const response = await fetch(audioUrl);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return buildPeaksFromArrayBuffer(arrayBuffer, bins);
}

async function buildPeaksFromArrayBuffer(arrayBuffer, bins = 320) {
  if (!arrayBuffer) return null;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await new Promise((resolve, reject) => {
      audioContext.decodeAudioData(
        arrayBuffer.slice(0),
        (buffer) => resolve(buffer),
        (error) => reject(error),
      );
    });
    const channelData = audioBuffer.getChannelData(0);
    if (!channelData || !channelData.length) return null;
    const targetBins = Math.max(64, Math.min(1024, Number(bins) || 320));
    const samplesPerBin = Math.max(1, Math.floor(channelData.length / targetBins));
    const data = [];
    for (let i = 0; i < targetBins; i += 1) {
      const start = i * samplesPerBin;
      const end = i === targetBins - 1 ? channelData.length : Math.min(channelData.length, start + samplesPerBin);
      if (start >= channelData.length || end <= start) {
        data.push(0, 0);
        continue;
      }
      let min = 1;
      let max = -1;
      for (let j = start; j < end; j += 1) {
        const value = channelData[j];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const minI16 = Math.max(-32768, Math.min(32767, Math.round(min * 32767)));
      const maxI16 = Math.max(-32768, Math.min(32767, Math.round(max * 32767)));
      data.push(minI16, maxI16);
    }
    return {
      format: "minmax_i16",
      bins: targetBins,
      data,
    };
  } finally {
    try {
      await audioContext.close();
    } catch {
      // noop
    }
  }
}

async function buildPeaksFromAudioBlob(audioBlob, bins = 320) {
  if (!audioBlob) return null;
  const arrayBuffer = await audioBlob.arrayBuffer();
  return buildPeaksFromArrayBuffer(arrayBuffer, bins);
}

export default function AudioPlayer({
  audioUrl,
  audioBlob = null,
  peaks = null,
  peaksUrl = null,
  height = 60,
  compact = false,
  showTime = true,
  autoPlaySignal = 0,
  pauseSignal = 0,
  seekToSeconds = null,
  seekSignal = 0,
  playOnSeek = false,
  onPlayStateChange = null,
  onTimeUpdate: onTimeUpdateProp = null,
}) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const pendingAutoPlayRef = useRef(false);
  const pendingSeekSecondsRef = useRef(null);
  const durationRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [resolvedPeaks, setResolvedPeaks] = useState(peaks || null);

  const applySeek = useCallback((seconds) => {
    const audio = audioRef.current;
    const rawSeconds = Number(seconds);
    if (!audio || !Number.isFinite(rawSeconds)) {
      return false;
    }
    const maxSeconds = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : Number(durationRef.current || 0);
    const nextTime = maxSeconds > 0
      ? Math.max(0, Math.min(maxSeconds, rawSeconds))
      : Math.max(0, rawSeconds);
    try {
      audio.currentTime = nextTime;
    } catch {
      pendingSeekSecondsRef.current = nextTime;
      return false;
    }
    const resolvedTime = audio.currentTime || nextTime;
    setCurrentTime(resolvedTime);
    onTimeUpdateProp?.(resolvedTime);
    return true;
  }, [onTimeUpdateProp]);

  useEffect(() => {
    setResolvedPeaks(peaks || null);
  }, [audioUrl, audioBlob, peaks, peaksUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    pendingSeekSecondsRef.current = null;

    const onLoadedMetadata = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      durationRef.current = nextDuration;
      setDuration(nextDuration);
    };
    const onCanPlay = () => {
      setIsReady(true);
      if (pendingSeekSecondsRef.current !== null) {
        const nextSeek = pendingSeekSecondsRef.current;
        pendingSeekSecondsRef.current = null;
        applySeek(nextSeek);
      }
      if (pendingAutoPlayRef.current) {
        pendingAutoPlayRef.current = false;
        audio.play().then(
          () => setIsPlaying(true),
          () => setIsPlaying(false),
        );
      }
    };
    const onTimeUpdate = () => {
      const nextTime = audio.currentTime || 0;
      setCurrentTime(nextTime);
      onTimeUpdateProp?.(nextTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      onTimeUpdateProp?.(audio.duration || audio.currentTime || 0);
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
      durationRef.current = 0;
    };
  }, [audioUrl, onTimeUpdateProp, applySeek]);

  useEffect(() => {
    onPlayStateChange?.(isPlaying);
  }, [isPlaying, onPlayStateChange]);

  useEffect(() => {
    if (!audioUrl || !autoPlaySignal) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    pendingAutoPlayRef.current = true;
    if (isReady) {
      audio.play().then(
        () => {
          pendingAutoPlayRef.current = false;
          setIsPlaying(true);
        },
        () => setIsPlaying(false),
      );
    }
  }, [autoPlaySignal, audioUrl, isReady]);

  useEffect(() => {
    if (!audioUrl || !seekSignal) {
      return;
    }
    const rawSeconds = Number(seekToSeconds);
    if (!Number.isFinite(rawSeconds)) {
      return;
    }
    pendingSeekSecondsRef.current = rawSeconds;
    if (isReady && applySeek(rawSeconds)) {
      pendingSeekSecondsRef.current = null;
    }
    if (playOnSeek) {
      pendingAutoPlayRef.current = true;
      const audio = audioRef.current;
      if (audio && isReady) {
        audio.play().then(
          () => {
            pendingAutoPlayRef.current = false;
            setIsPlaying(true);
          },
          () => setIsPlaying(false),
        );
      }
    }
  }, [audioUrl, seekSignal, seekToSeconds, playOnSeek, isReady, applySeek]);

  useEffect(() => {
    if (!audioUrl || !pauseSignal) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    pendingAutoPlayRef.current = false;
    setIsPlaying(false);
  }, [pauseSignal, audioUrl]);

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
        const extractedData = extractPeaksData(payload);
        const normalized = {
          format: payload.format || "minmax_i16",
          bins: Number(payload.level || payload.bins || 0),
          data: extractedData,
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
    let canceled = false;
    async function buildDecodedPeaks() {
      if (!audioUrl || resolvedPeaks) {
        return;
      }
      if (decodedPeaksCache.has(audioUrl)) {
        setResolvedPeaks(decodedPeaksCache.get(audioUrl));
        return;
      }
      try {
        let decoded = null;
        if (audioBlob) {
          decoded = await buildPeaksFromAudioBlob(audioBlob);
        }
        if (!decoded) {
          decoded = await buildPeaksFromAudioUrl(audioUrl);
        }
        if (!decoded || canceled) return;
        decodedPeaksCache.set(audioUrl, decoded);
        setResolvedPeaks(decoded);
      } catch {
        // keep silent fallback line when decode fails
      }
    }
    buildDecodedPeaks();
    return () => {
      canceled = true;
    };
  }, [audioUrl, audioBlob, resolvedPeaks]);

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
    const visibleBars = Math.max(1, Math.ceil(cssWidth / step));
    let x = 0;

    for (let i = 0; i < visibleBars && x < cssWidth; i += 1) {
      const sourceStart = Math.floor((i * bars.length) / visibleBars);
      const sourceEnd = Math.max(sourceStart + 1, Math.floor(((i + 1) * bars.length) / visibleBars));
      let min = 1;
      let max = -1;
      for (let j = sourceStart; j < Math.min(sourceEnd, bars.length); j += 1) {
        min = Math.min(min, bars[j].min);
        max = Math.max(max, bars[j].max);
      }
      const item = {
        min: Number.isFinite(min) && min <= 1 ? min : 0,
        max: Number.isFinite(max) && max >= -1 ? max : 0,
      };
      const minY = mid + item.min * mid * 0.92;
      const maxY = mid + item.max * mid * 0.92;
      const top = Math.min(minY, maxY);
      const bottom = Math.max(minY, maxY);
      const h = Math.max(1, bottom - top);
      ctx.fillStyle = x <= progressX ? "rgba(92, 211, 255, 0.95)" : "rgba(161, 161, 170, 0.55)";
      ctx.fillRect(x, top, Math.min(barWidth, cssWidth - x), h);
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

  const seekToRatio = (ratio) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(duration, duration * ratio));
    setCurrentTime(audio.currentTime || 0);
    onTimeUpdateProp?.(audio.currentTime || 0);
  };

  const seekBySeconds = (deltaSeconds) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(duration, (audio.currentTime || 0) + deltaSeconds));
    setCurrentTime(audio.currentTime || 0);
    onTimeUpdateProp?.(audio.currentTime || 0);
  };

  if (!audioUrl) return null;

  return (
    <div
      className={`audioPlayer${compact ? " compact" : ""}${showTime ? "" : " noTime"}`}
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
        type="button"
        onClick={togglePlay}
        disabled={!isReady}
        aria-label={isPlaying ? "暂停音频" : "播放音频"}
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
          <Pause aria-hidden="true" focusable="false" size={compact ? 14 : 17} />
        ) : (
          <Play aria-hidden="true" focusable="false" size={compact ? 14 : 17} style={{ marginLeft: 1 }} />
        )}
      </button>

      <div className="audioPlayerWaveform" style={{ flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          role="slider"
          tabIndex={isReady ? 0 : -1}
          aria-label="音频波形进度"
          aria-disabled={!isReady}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.max(0, Math.round(currentTime))}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          style={{
            width: "100%",
            height,
            borderRadius: 8,
            cursor: isReady ? "pointer" : "default",
          }}
          onClick={(event) => {
            if (!duration) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            seekToRatio(ratio);
          }}
          onKeyDown={(event) => {
            if (!duration || !isReady) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              seekBySeconds(-5);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              seekBySeconds(5);
            } else if (event.key === "Home") {
              event.preventDefault();
              seekToRatio(0);
            } else if (event.key === "End") {
              event.preventDefault();
              seekToRatio(1);
            }
          }}
        />
      </div>

      {showTime ? (
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
      ) : null}

      {!compact && (
        <Volume2 size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      )}
      <audio ref={audioRef} src={audioUrl} preload="metadata" style={{ display: "none" }} />
    </div>
  );
}
