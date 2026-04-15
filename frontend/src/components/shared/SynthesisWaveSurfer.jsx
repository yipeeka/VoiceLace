import { Pause, Play, Volume2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";

import Slider from "../ui/Slider";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SynthesisWaveSurfer({ audioUrl, segments = [], gapDurationMs = 500, height = 100 }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(0);

  // Compute regions data based on segments and gap
  const regionConfig = useMemo(() => {
    const defaultColor = "rgba(100, 100, 100, 0.1)";
    const colors = [
      "rgba(59, 130, 246, 0.2)",
      "rgba(16, 185, 129, 0.2)",
      "rgba(245, 158, 11, 0.2)",
      "rgba(236, 72, 153, 0.2)",
      "rgba(139, 92, 246, 0.2)"
    ];

    let cursor = 0;
    const speakerColors = {};
    let colorIndex = 0;

    return segments.map((seg, idx) => {
      const dur = (seg.duration_ms || 2000) / 1000; // approx 2s if missing
      if (!speakerColors[seg.speaker]) {
        speakerColors[seg.speaker] = colors[colorIndex % colors.length];
        colorIndex++;
      }
      
      const config = {
        id: seg.segment_id || `region-${idx}`,
        start: cursor,
        end: cursor + dur,
        content: document.createTextNode(`${seg.speaker}`),
        color: speakerColors[seg.speaker] || defaultColor,
        drag: false,
        resize: false,
        text: seg.text
      };
      
      cursor += dur + (gapDurationMs / 1000);
      return config;
    });
  }, [segments, gapDurationMs]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

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
        barWidth: 2,
        barGap: 1,
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
              paddingTop: "2px"
            }
          }),
          regionsPlugin
        ]
      });

      ws.load(audioUrl);
    } catch {
      return undefined;
    }

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsReady(true);
      
      // Add regions after audio is loaded so we don't go out of bounds
      regionConfig.forEach(config => {
        const region = regionsPlugin.addRegion(config);
        
        // Add a tooltip or basic text element
        const contentEl = region.element.querySelector('.wavesurfer-region-content');
        if (contentEl) {
           contentEl.style.fontSize = "11px";
           contentEl.style.padding = "2px 4px";
           contentEl.style.color = "var(--text-secondary)";
           contentEl.style.whiteSpace = "nowrap";
           contentEl.style.overflow = "hidden";
           contentEl.style.textOverflow = "ellipsis";
           contentEl.title = config.text; // Native tooltip
        }
      });
    });

    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("finish", () => setIsPlaying(false));
    
    // Zoom handler wrapper
    wavesurferRef.current = ws;

    return () => {
      ws?.destroy();
      setIsPlaying(false);
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [audioUrl, regionConfig, height]);

  // Adjust zoom smoothly
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      if (zoom === 0) {
        // small enough minPxPerSec that WS7 expands it to 100% container width
        wavesurferRef.current.zoom(1); 
      } else {
        // Map 1-100 to something like 20-300 minPxPerSec
        wavesurferRef.current.zoom(10 + zoom * 3);
      }
    }
  }, [zoom, isReady]);

  const togglePlay = () => {
    if (!wavesurferRef.current || !isReady) return;
    wavesurferRef.current.playPause();
    setIsPlaying((p) => !p);
  };

  if (!audioUrl) return null;

  return (
    <div className="synthesisWaveformShell" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls row */}
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

        {/* Zoom controls */}
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

      {/* Waveform and Timeline Layout */}
      <div 
        style={{ 
          background: "var(--bg-elevated)", 
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden" 
        }}
      >
        <div ref={containerRef} style={{ width: "100%" }} />
      </div>
    </div>
  );
}
