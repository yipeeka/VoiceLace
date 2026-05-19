import { Pause, Play, RotateCcw, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";

import {
  formatClipTime,
  getClipDurationSec,
  isFullClipRange,
  normalizeClipRange,
} from "../../utils/audioClip";
import Button from "../ui/Button";
import Slider from "../ui/Slider";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapZoomToPixelsPerSecond(zoom) {
  const t = Math.max(0, Math.min(1, Number(zoom || 0) / 100));
  return 1 + t * t * 120;
}

function buildRange(clipRange, duration) {
  if (!duration) return { startSec: 0, endSec: 0 };
  return normalizeClipRange(clipRange || { startSec: 0, endSec: duration }, duration) || { startSec: 0, endSec: duration };
}

export default function AudioClipper({
  audioUrl,
  fileName,
  disabled = false,
  clipRange,
  onClipRangeChange,
  onDurationChange,
  onError,
}) {
  const generatedId = useId();
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);
  const regionsPluginRef = useRef(null);
  const activeRegionRef = useRef(null);
  const applyingRangeRef = useRef(false);
  const disabledRef = useRef(disabled);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [loadError, setLoadError] = useState("");

  const displayedRange = useMemo(() => buildRange(clipRange, duration), [clipRange, duration]);
  const hasClip = Boolean(duration && clipRange && !isFullClipRange(clipRange, duration));
  const clipDuration = hasClip ? getClipDurationSec(clipRange, duration) : duration;
  const hintId = `${generatedId}-hint`;
  const startInputId = `${generatedId}-start`;
  const endInputId = `${generatedId}-end`;

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return undefined;

    setDuration(0);
    setCurrentTime(0);
    setIsReady(false);
    setIsPlaying(false);
    setLoadError("");
    activeRegionRef.current = null;

    const regionsPlugin = RegionsPlugin.create();
    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgba(161, 161, 170, 0.42)",
      progressColor: "var(--accent-primary)",
      cursorColor: "var(--accent-secondary)",
      height: 96,
      barWidth: 1.4,
      barGap: 0,
      barRadius: 2,
      normalize: true,
      hideScrollbar: false,
      plugins: [
        TimelinePlugin.create({
          height: 22,
          timeInterval: 5,
          primaryLabelInterval: 10,
          style: {
            fontSize: "10px",
            color: "var(--text-muted)",
            fontFamily: "monospace",
            borderTop: "1px solid var(--border-default)",
            background: "var(--bg-default)",
          },
        }),
        regionsPlugin,
      ],
    });

    waveSurfer.load(audioUrl);
    waveSurferRef.current = waveSurfer;
    regionsPluginRef.current = regionsPlugin;

    regionsPlugin.enableDragSelection({
      color: "rgba(59, 130, 246, 0.22)",
    });

    const emitRegion = (region) => {
      if (applyingRangeRef.current || disabledRef.current || !region) return;
      const nextDuration = waveSurfer.getDuration();
      if (!nextDuration) return;
      const nextRange = normalizeClipRange({ startSec: region.start, endSec: region.end }, nextDuration);
      if (!nextRange) return;
      onClipRangeChange?.(isFullClipRange(nextRange, nextDuration) ? null : nextRange);
    };

    waveSurfer.on("ready", () => {
      const nextDuration = waveSurfer.getDuration();
      setDuration(nextDuration);
      setIsReady(true);
      setLoadError("");
      onDurationChange?.(nextDuration);
    });
    waveSurfer.on("audioprocess", () => setCurrentTime(waveSurfer.getCurrentTime()));
    waveSurfer.on("seeking", () => setCurrentTime(waveSurfer.getCurrentTime()));
    waveSurfer.on("play", () => setIsPlaying(true));
    waveSurfer.on("pause", () => setIsPlaying(false));
    waveSurfer.on("finish", () => setIsPlaying(false));
    waveSurfer.on("error", (error) => {
      const message = String(error?.message || error || "音频波形加载失败。");
      if (message.toLowerCase().includes("abort") || message.toLowerCase().includes("destroy")) {
        return;
      }
      setLoadError(message);
      setIsReady(false);
      setIsPlaying(false);
      onError?.(message);
    });
    regionsPlugin.on("region-created", (region) => {
      if (applyingRangeRef.current) return;
      if (activeRegionRef.current && activeRegionRef.current !== region) {
        activeRegionRef.current.remove();
      }
      activeRegionRef.current = region;
      emitRegion(region);
    });
    regionsPlugin.on("region-updated", emitRegion);
    regionsPlugin.on("region-clicked", (region, event) => {
      event.stopPropagation();
      waveSurfer.setTime(region.start);
    });

    return () => {
      waveSurfer.destroy();
      waveSurferRef.current = null;
      regionsPluginRef.current = null;
      activeRegionRef.current = null;
      setIsReady(false);
      setIsPlaying(false);
    };
  }, [audioUrl, onClipRangeChange, onDurationChange, onError]);

  useEffect(() => {
    if (!isReady || !duration || !regionsPluginRef.current) return;
    const range = buildRange(clipRange, duration);
    applyingRangeRef.current = true;
    activeRegionRef.current?.remove();
    activeRegionRef.current = regionsPluginRef.current.addRegion({
      start: range.startSec,
      end: range.endSec,
      color: hasClip ? "rgba(59, 130, 246, 0.24)" : "rgba(161, 161, 170, 0.12)",
      drag: !disabled,
      resize: !disabled,
    });
    queueMicrotask(() => {
      applyingRangeRef.current = false;
    });
  }, [clipRange, disabled, duration, hasClip, isReady]);

  useEffect(() => {
    if (!isReady || !waveSurferRef.current) return;
    try {
      waveSurferRef.current.zoom(mapZoomToPixelsPerSecond(zoom));
    } catch {
      setLoadError("波形缩放失败，已保持当前视图。");
    }
  }, [zoom, isReady]);

  function updateRange(part, value) {
    if (!duration) return;
    const seconds = clamp(Number(value || 0), 0, duration);
    const next = part === "start"
      ? { startSec: seconds, endSec: displayedRange.endSec }
      : { startSec: displayedRange.startSec, endSec: seconds };
    const normalized = normalizeClipRange(next, duration);
    onClipRangeChange?.(normalized && !isFullClipRange(normalized, duration) ? normalized : null);
  }

  async function togglePlay() {
    if (!isReady || !waveSurferRef.current || disabled) return;
    try {
      if (hasClip && !isPlaying) {
        await waveSurferRef.current.play(displayedRange.startSec, displayedRange.endSec);
        return;
      }
      await waveSurferRef.current.playPause();
    } catch {
      setLoadError("音频尚未就绪，请稍后重试。");
    }
  }

  function resetClip() {
    onClipRangeChange?.(null);
    if (waveSurferRef.current) {
      waveSurferRef.current.setTime(0);
    }
  }

  if (!audioUrl) return null;

  return (
    <div className="audioClipper">
      <div className="audioClipperHeader">
        <div className="audioClipperMeta">
          <span className={`statusBadge ${hasClip ? "success" : "default"}`}>
            {hasClip ? "使用截取片段" : "使用完整音频"}
          </span>
          <span className="muted audioClipperFile" title={fileName || ""}>{fileName || "audio"}</span>
          <span className="muted audioClipperTime">{formatClipTime(currentTime)} / {formatClipTime(duration)}</span>
        </div>
        <div className="audioClipperActions">
          <Button
            variant="secondary"
            size="sm"
            icon={isPlaying ? Pause : Play}
            onClick={togglePlay}
            disabled={!isReady || disabled}
          >
            {isPlaying ? "暂停" : hasClip ? "播放选区" : "播放"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            onClick={resetClip}
            disabled={!isReady || disabled || !hasClip}
          >
            使用完整音频
          </Button>
        </div>
      </div>

      <div
        className="audioClipperWave"
        ref={containerRef}
        role="group"
        aria-describedby={hintId}
        aria-label="音频波形截取区域"
      />

      <div className="audioClipperControls">
        <div className="formGroup">
          <label className="formLabel" htmlFor={startInputId}>开始</label>
          <input
            id={startInputId}
            name="audio_clip_start"
            className="textInput"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            min="0"
            max={duration || 0}
            step="0.01"
            value={Number(displayedRange.startSec || 0).toFixed(2)}
            onChange={(event) => updateRange("start", event.target.value)}
            disabled={!isReady || disabled}
            aria-describedby={hintId}
          />
        </div>
        <div className="formGroup">
          <label className="formLabel" htmlFor={endInputId}>结束</label>
          <input
            id={endInputId}
            name="audio_clip_end"
            className="textInput"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            min="0"
            max={duration || 0}
            step="0.01"
            value={Number(displayedRange.endSec || 0).toFixed(2)}
            onChange={(event) => updateRange("end", event.target.value)}
            disabled={!isReady || disabled}
            aria-describedby={hintId}
          />
        </div>
        <div className="audioClipperDuration">
          <Scissors aria-hidden="true" focusable="false" size={14} />
          <span>{formatClipTime(clipDuration || 0)}</span>
        </div>
        <div className="audioClipperZoom">
          <ZoomOut aria-hidden="true" focusable="false" size={14} />
          <Slider
            ariaLabel="音频波形缩放"
            value={[zoom]}
            onValueChange={([value]) => setZoom(value)}
            min={0}
            max={100}
            step={1}
            disabled={!isReady || disabled}
            hideValue
          />
          <ZoomIn aria-hidden="true" focusable="false" size={14} />
        </div>
      </div>

      <div id={hintId} className="muted audioClipperHint">
        可拖拽波形创建或调整一个截取范围；识别和创建项目会优先使用该片段。
      </div>
      {loadError ? <div className="errorText" role="alert">{loadError}</div> : null}
    </div>
  );
}
