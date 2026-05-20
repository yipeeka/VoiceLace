import { Pause, Play, RefreshCcw, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

const audioBlobCache = new Map();

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function getAudioBlob(audioUrl, signal) {
  if (audioBlobCache.has(audioUrl)) {
    return audioBlobCache.get(audioUrl);
  }
  const response = await fetch(audioUrl, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Audio request failed: ${response.status}`);
  }
  const blob = await response.blob();
  audioBlobCache.set(audioUrl, blob);
  return blob;
}

export default function WaveSurferAudioPlayer({
  audioUrl,
  height = 60,
  compact = false,
  showTime = true,
  fallbackDurationSeconds = 0,
  autoPlaySignal = 0,
  pauseSignal = 0,
  seekToSeconds = null,
  seekSignal = 0,
  playOnSeek = false,
  onPlayStateChange = null,
  onTimeUpdate: onTimeUpdateProp = null,
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const pendingAutoPlayRef = useRef(false);
  const pendingSeekSecondsRef = useRef(null);
  const readyRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState("idle");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!isReady) {
      const fallbackDuration = Number(fallbackDurationSeconds || 0);
      setDuration(Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0);
    }
  }, [audioUrl, fallbackDurationSeconds, isReady]);

  useEffect(() => {
    onPlayStateChange?.(isPlaying);
  }, [isPlaying, onPlayStateChange]);

  useEffect(() => {
    onTimeUpdateProp?.(currentTime);
  }, [currentTime, onTimeUpdateProp]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return undefined;

    let ws = null;
    let canceled = false;
    const abortController = new AbortController();

    try {
      ws = WaveSurfer.create({
        container: containerRef.current,
        height,
        waveColor: "rgba(161, 161, 170, 0.58)",
        progressColor: "rgba(92, 211, 255, 0.95)",
        cursorColor: "rgba(255, 255, 255, 0.92)",
        cursorWidth: 2,
        barWidth: compact ? 2 : 2.5,
        barGap: compact ? 1 : 1.5,
        barRadius: 2,
        normalize: true,
        fillParent: true,
        interact: true,
        dragToSeek: true,
        mediaControls: false,
        backend: "MediaElement",
      });
    } catch {
      setLoadStatus("error");
      return undefined;
    }

    const applySeek = (seconds) => {
      const rawSeconds = Number(seconds);
      if (!Number.isFinite(rawSeconds)) return false;
      const nextDuration = ws.getDuration() || 0;
      const nextTime = nextDuration > 0
        ? Math.max(0, Math.min(nextDuration, rawSeconds))
        : Math.max(0, rawSeconds);
      try {
        if (typeof ws.setTime === "function") {
          ws.setTime(nextTime);
        } else if (nextDuration > 0) {
          ws.seekTo(nextTime / nextDuration);
        }
        setCurrentTime(nextTime);
        return true;
      } catch {
        pendingSeekSecondsRef.current = nextTime;
        return false;
      }
    };

    ws.on("ready", () => {
      const nextDuration = ws.getDuration() || 0;
      readyRef.current = true;
      setDuration(nextDuration);
      setIsReady(true);
      setLoadStatus("ready");

      if (pendingSeekSecondsRef.current !== null) {
        const nextSeek = pendingSeekSecondsRef.current;
        pendingSeekSecondsRef.current = null;
        applySeek(nextSeek);
      }
      if (pendingAutoPlayRef.current) {
        pendingAutoPlayRef.current = false;
        ws.play().catch(() => setIsPlaying(false));
      }
    });

    const syncCurrentTime = () => setCurrentTime(ws.getCurrentTime() || 0);
    ws.on("audioprocess", syncCurrentTime);
    ws.on("timeupdate", syncCurrentTime);
    ws.on("seeking", syncCurrentTime);
    ws.on("interaction", syncCurrentTime);
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      setCurrentTime(ws.getDuration() || ws.getCurrentTime() || 0);
    });
    ws.on("error", () => {
      if (!readyRef.current) {
        setIsReady(false);
        setLoadStatus("error");
      }
      setIsPlaying(false);
    });

    wavesurferRef.current = ws;

    async function loadWaveform() {
      setLoadStatus("loading");
      setIsReady(false);
      try {
        const blob = await getAudioBlob(audioUrl, abortController.signal);
        if (canceled) return;
        await ws.loadBlob(blob);
      } catch (error) {
        if (canceled || error?.name === "AbortError") return;
        setLoadStatus("error");
        setIsReady(false);
        if (import.meta?.env?.DEV) {
          console.warn("[WaveSurferAudioPlayer] source audio load failed.", error);
        }
      }
    }

    loadWaveform();

    return () => {
      canceled = true;
      abortController.abort();
      ws.destroy();
      wavesurferRef.current = null;
      readyRef.current = false;
      pendingAutoPlayRef.current = false;
      pendingSeekSecondsRef.current = null;
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(Number(fallbackDurationSeconds || 0) || 0);
    };
  }, [audioUrl, height, compact, retryToken, fallbackDurationSeconds]);

  useEffect(() => {
    if (!audioUrl || !autoPlaySignal) return;
    pendingAutoPlayRef.current = true;
    const ws = wavesurferRef.current;
    if (ws && isReady) {
      ws.play().then(
        () => {
          pendingAutoPlayRef.current = false;
          setIsPlaying(true);
        },
        () => setIsPlaying(false),
      );
    }
  }, [autoPlaySignal, audioUrl, isReady]);

  useEffect(() => {
    if (!audioUrl || !pauseSignal) return;
    const ws = wavesurferRef.current;
    if (!ws) return;
    pendingAutoPlayRef.current = false;
    ws.pause();
    setIsPlaying(false);
  }, [pauseSignal, audioUrl]);

  useEffect(() => {
    if (!audioUrl || !seekSignal) return;
    const rawSeconds = Number(seekToSeconds);
    if (!Number.isFinite(rawSeconds)) return;
    pendingSeekSecondsRef.current = rawSeconds;
    const ws = wavesurferRef.current;
    if (ws && isReady) {
      const nextDuration = ws.getDuration() || duration || 0;
      const nextTime = nextDuration > 0
        ? Math.max(0, Math.min(nextDuration, rawSeconds))
        : Math.max(0, rawSeconds);
      try {
        if (typeof ws.setTime === "function") {
          ws.setTime(nextTime);
        } else if (nextDuration > 0) {
          ws.seekTo(nextTime / nextDuration);
        }
        pendingSeekSecondsRef.current = null;
        setCurrentTime(nextTime);
        if (playOnSeek) {
          ws.play().catch(() => setIsPlaying(false));
        }
      } catch {
        pendingSeekSecondsRef.current = nextTime;
      }
    }
  }, [audioUrl, seekSignal, seekToSeconds, playOnSeek, isReady, duration]);

  const togglePlay = async () => {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) return;
    try {
      await ws.playPause();
    } catch {
      setIsPlaying(false);
    }
  };

  if (!audioUrl) return null;

  return (
    <div
      className={`audioPlayer waveSurferAudioPlayer${compact ? " compact" : ""}${showTime ? "" : " noTime"}`}
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

      <div
        className="audioPlayerWaveform"
        role="slider"
        tabIndex={isReady ? 0 : -1}
        aria-label="音频波形进度"
        aria-disabled={!isReady}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.max(0, Math.round(currentTime))}
        aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
        style={{
          flex: 1,
          minWidth: 0,
          height,
          cursor: isReady ? "pointer" : "default",
          position: "relative",
          display: "grid",
          alignItems: "center",
        }}
        onKeyDown={(event) => {
          const ws = wavesurferRef.current;
          if (!ws || !duration || !isReady) return;
          let nextTime = null;
          if (event.key === "ArrowLeft") {
            nextTime = Math.max(0, currentTime - 5);
          } else if (event.key === "ArrowRight") {
            nextTime = Math.min(duration, currentTime + 5);
          } else if (event.key === "Home") {
            nextTime = 0;
          } else if (event.key === "End") {
            nextTime = duration;
          }
          if (nextTime === null) return;
          event.preventDefault();
          if (typeof ws.setTime === "function") {
            ws.setTime(nextTime);
          } else {
            ws.seekTo(nextTime / duration);
          }
          setCurrentTime(nextTime);
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height }} />
        {loadStatus !== "ready" ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-muted)",
              fontSize: 12,
              pointerEvents: loadStatus === "error" ? "auto" : "none",
            }}
          >
            {loadStatus === "error" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setRetryToken((value) => value + 1);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <RefreshCcw aria-hidden="true" focusable="false" size={13} />
                重新加载波形
              </button>
            ) : (
              "波形加载中..."
            )}
          </div>
        ) : null}
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

      {!compact && <Volume2 size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
    </div>
  );
}
