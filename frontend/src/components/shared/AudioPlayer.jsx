import { Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ audioUrl, height = 60, compact = false }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    let ws = null;
    try {
      ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(161, 161, 170, 0.4)",
        progressColor: "var(--accent-primary)",
        cursorColor: "var(--accent-secondary)",
        height,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
      });
      ws.load(audioUrl);
      setHasLoadError(false);
    } catch {
      setHasLoadError(true);
      return undefined;
    }

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsReady(true);
      setHasLoadError(false);
    });
    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("error", () => {
      setHasLoadError(true);
      setIsReady(false);
    });

    wavesurferRef.current = ws;
    return () => {
      ws?.destroy();
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [audioUrl, height]);

  const togglePlay = () => {
    if (!wavesurferRef.current || !isReady) return;
    wavesurferRef.current.playPause();
    setIsPlaying((p) => !p);
  };

  if (!audioUrl) return null;
  if (hasLoadError) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "100%",
          background: "var(--bg-elevated)",
          padding: compact ? "8px 10px" : "10px 14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
        }}
      >
        <audio controls src={audioUrl} style={{ width: "100%" }} />
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          波形加载失败，已切换为基础播放器。
        </span>
      </div>
    );
  }

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

      <div ref={containerRef} style={{ flex: 1, minWidth: 0 }} />

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
    </div>
  );
}
