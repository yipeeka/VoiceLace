import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

import GlassCard from "../shared/GlassCard";
import SynthesisWaveSurfer from "../shared/SynthesisWaveSurfer";
import Button from "../ui/Button";
import SynthesisArrangementTimeline from "./SynthesisArrangementTimeline";

function isEditableTarget(target) {
  const tagName = String(target?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
}

export default function SynthesisFullAudioCard({
  projectId,
  fullAudioUrl,
  audioVariant = "raw",
  segments,
  gapDurationMs,
  useSourceTimeline = false,
  onCurrentTimeChange,
  seekToSeconds = null,
  seekSignal = 0,
  playOnSeek = false,
  fullAudioCurrentTime = 0,
  arrangementDraft,
  arrangementDirty = false,
  arrangementWarnings = {},
  onArrangementDraftChange,
  onApplyArrangementDraft,
  onResetArrangementDraft,
  config,
  onSetConfig,
  isRunning = false,
  bgmPreviewUrl = "",
  ambiencePreviewUrl = "",
  className = "",
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSignal, setPlaySignal] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);
  const [arrangementCollapsed, setArrangementCollapsed] = useState(true);
  const [fullAudioDurationMs, setFullAudioDurationMs] = useState(0);
  const [waveformSync, setWaveformSync] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    pixelsPerSecond: 0,
  });
  const [waveformScrollRequest, setWaveformScrollRequest] = useState({ left: 0, signal: 0 });
  const [assetDurationsMs, setAssetDurationsMs] = useState({ bgm: 0, ambience: 0 });

  useEffect(() => {
    if (!fullAudioUrl) {
      return undefined;
    }
    function onKeyDown(event) {
      if (event.code !== "Space" || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (isPlaying) {
        setPauseSignal((value) => value + 1);
      } else {
        setPlaySignal((value) => value + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullAudioUrl, isPlaying]);

  useEffect(() => {
    function loadAudioDuration(type, url) {
      if (!url) {
        setAssetDurationsMs((current) => ({ ...current, [type]: 0 }));
        return () => undefined;
      }
      const audio = document.createElement("audio");
      const handleLoaded = () => {
        const durationMs = Number.isFinite(Number(audio.duration)) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : 0;
        setAssetDurationsMs((current) => ({ ...current, [type]: durationMs }));
      };
      const handleError = () => {
        setAssetDurationsMs((current) => ({ ...current, [type]: 0 }));
      };
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", handleLoaded);
      audio.addEventListener("error", handleError);
      audio.src = url;
      audio.load();
      return () => {
        audio.removeEventListener("loadedmetadata", handleLoaded);
        audio.removeEventListener("error", handleError);
        audio.removeAttribute("src");
        audio.load();
      };
    }

    const cleanupBgm = loadAudioDuration("bgm", bgmPreviewUrl);
    const cleanupAmbience = loadAudioDuration("ambience", ambiencePreviewUrl);
    return () => {
      cleanupBgm();
      cleanupAmbience();
    };
  }, [bgmPreviewUrl, ambiencePreviewUrl]);

  if (!fullAudioUrl) {
    return null;
  }

  const bgmBound = Boolean(config?.bgm_track?.relpath);
  const ambienceBound = Boolean(config?.ambience_track?.relpath);

  function handleArrangementScrollLeftChange(scrollLeft) {
    const nextLeft = Math.max(0, Number(scrollLeft || 0));
    setWaveformSync((current) => ({ ...current, scrollLeft: nextLeft }));
    setWaveformScrollRequest((current) => ({ left: nextLeft, signal: current.signal + 1 }));
  }

  const arrangementTimeline = arrangementDraft && !arrangementCollapsed ? (
    <SynthesisArrangementTimeline
      draft={arrangementDraft}
      fullAudioDurationMs={fullAudioDurationMs}
      currentTimeMs={Math.round(Number(fullAudioCurrentTime || 0) * 1000)}
      onDraftChange={onArrangementDraftChange}
      config={config}
      onSetConfig={onSetConfig}
      warnings={arrangementWarnings}
      bgmBound={bgmBound}
      ambienceBound={ambienceBound}
      bgmDurationMs={assetDurationsMs.bgm}
      ambienceDurationMs={assetDurationsMs.ambience}
      syncPixelsPerSecond={waveformSync.pixelsPerSecond}
      syncScrollWidth={waveformSync.scrollWidth}
      syncClientWidth={waveformSync.clientWidth}
      scrollLeft={waveformSync.scrollLeft}
      onScrollLeftChange={handleArrangementScrollLeftChange}
      disabled={isRunning}
      embedded
    />
  ) : null;

  return (
    <GlassCard className={className}>
      <div className="sectionHeader">
        <div className="sectionHeaderLeft">
          <h2 className="cardTitle">
            完整音频编排
            {arrangementDirty ? <span className="statusBadge warning">预览未应用</span> : <span className="statusBadge success">已同步</span>}
          </h2>
          <p className="cardSubtitle">拖动分段只更新视觉预览，应用后再写入剧本时间轴。</p>
        </div>
        <div className="controlRow" style={{ justifyContent: "flex-end" }}>
          {arrangementDraft ? (
            <Button
              variant="ghost"
              size="sm"
              icon={arrangementCollapsed ? ChevronDown : ChevronUp}
              onClick={() => setArrangementCollapsed((value) => !value)}
            >
              {arrangementCollapsed ? "展开编排" : "收起编排"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!arrangementDirty || isRunning}
            onClick={onResetArrangementDraft}
          >
            重置预览
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangementDirty || isRunning}
            onClick={onApplyArrangementDraft}
          >
            应用到剧本草稿
          </Button>
        </div>
      </div>

      <SynthesisWaveSurfer
        projectId={projectId}
        audioUrl={fullAudioUrl}
        audioVariant={audioVariant}
        segments={segments}
        gapDurationMs={gapDurationMs}
        useSourceTimeline={useSourceTimeline}
        height={48}
        onCurrentTimeChange={onCurrentTimeChange}
        autoPlaySignal={playSignal}
        pauseSignal={pauseSignal}
        seekToSeconds={seekToSeconds}
        seekSignal={seekSignal}
        playOnSeek={playOnSeek}
        onPlayStateChange={setIsPlaying}
        onDurationChange={(durationSeconds) => setFullAudioDurationMs(Math.round(Number(durationSeconds || 0) * 1000))}
        onWaveformSyncChange={setWaveformSync}
        externalScrollLeft={waveformScrollRequest.left}
        externalScrollSignal={waveformScrollRequest.signal}
      >
        {arrangementTimeline}
      </SynthesisWaveSurfer>
    </GlassCard>
  );
}
