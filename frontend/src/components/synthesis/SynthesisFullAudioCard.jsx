import { useEffect, useState } from "react";

import Button from "../ui/Button";
import GlassCard from "../shared/GlassCard";
import SynthesisWaveSurfer from "../shared/SynthesisWaveSurfer";
import SegmentTimelinePreview from "./SegmentTimelinePreview";

function isEditableTarget(target) {
  const tagName = String(target?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
}

export default function SynthesisFullAudioCard({
  projectId,
  fullAudioUrl,
  rawAudioUrl = "",
  processedAudioUrl = "",
  audioVariant = "raw",
  onAudioVariantChange,
  segments,
  gapDurationMs,
  useSourceTimeline = false,
  onCurrentTimeChange,
  seekToSeconds = null,
  seekSignal = 0,
  playOnSeek = false,
  fullAudioCurrentTime = 0,
  segmentTimings = {},
  currentSegmentId = "",
  onLocateFullAudioSegment,
  onSegmentTimingChange,
  config = {},
  onSetConfig,
  selectedPostprocessTrackId = "",
  pendingPostprocessTrackOffsets = {},
  onSelectPostprocessTrack,
  onPreviewPostprocessTrackOffsetChange,
  className = "",
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSignal, setPlaySignal] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);
  const [waveformSync, setWaveformSync] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    pixelsPerSecond: 0,
  });
  const [waveformScrollRequest, setWaveformScrollRequest] = useState({ left: 0, signal: 0 });

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

  if (!fullAudioUrl) {
    return null;
  }

  function handleVariantChange(variant) {
    onAudioVariantChange?.(variant);
  }

  function handleArrangementScrollLeftChange(scrollLeft) {
    const nextLeft = Math.max(0, Number(scrollLeft || 0));
    setWaveformSync((current) => ({ ...current, scrollLeft: nextLeft }));
    setWaveformScrollRequest((current) => ({ left: nextLeft, signal: current.signal + 1 }));
  }

  return (
    <GlassCard className={className}>
      <div className="sectionHeader">
        <div className="sectionHeaderLeft">
          <h2 className="cardTitle">完整音频</h2>
          <p className="cardSubtitle">播放整轨并通过下方片段时间线定位、同步高亮。</p>
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
        onWaveformSyncChange={setWaveformSync}
        externalScrollLeft={waveformScrollRequest.left}
        externalScrollSignal={waveformScrollRequest.signal}
        toolbarActions={(
          <div className="synthesisWaveformVariantActions" aria-label="音频版本播放">
            <Button
              variant={audioVariant === "raw" ? "primary" : "secondary"}
              size="sm"
              disabled={!rawAudioUrl}
              onClick={() => handleVariantChange("raw")}
            >
              原始
            </Button>
            <Button
              variant={audioVariant === "processed" ? "primary" : "secondary"}
              size="sm"
              disabled={!processedAudioUrl}
              onClick={() => handleVariantChange("processed")}
            >
              后期
            </Button>
          </div>
        )}
      >
        <SegmentTimelinePreview
          segments={segments}
          segmentTimings={segmentTimings}
          currentTimeMs={Math.round(Number(fullAudioCurrentTime || 0) * 1000)}
          currentSegmentId={currentSegmentId}
          config={config}
          selectedTrackId={selectedPostprocessTrackId}
          pendingTrackOffsets={pendingPostprocessTrackOffsets}
          waveformSync={waveformSync}
          onScrollLeftChange={handleArrangementScrollLeftChange}
          onSegmentClick={onLocateFullAudioSegment}
          onSegmentTimingChange={onSegmentTimingChange}
          onTrackSelect={onSelectPostprocessTrack}
          onTrackOffsetChange={(kind, trackId, offsetMs) => {
            if (onPreviewPostprocessTrackOffsetChange) {
              onPreviewPostprocessTrackOffsetChange(kind, trackId, offsetMs);
              return;
            }
            if (!onSetConfig) return;
            if (trackId === "legacy-bgm") {
              onSetConfig({ bgm_track: { ...(config.bgm_track || {}), offset_ms: offsetMs } });
              return;
            }
            if (trackId === "legacy-ambience") {
              onSetConfig({ ambience_track: { ...(config.ambience_track || {}), offset_ms: offsetMs } });
              return;
            }
            const key = kind === "music" ? "music_tracks" : "effect_tracks";
            const tracks = Array.isArray(config[key]) ? config[key] : [];
            onSetConfig({
              [key]: tracks.map((track, index) => {
                const id = String(track?.id || `${kind}-${index + 1}`);
                return id === trackId ? { ...track, offset_ms: offsetMs } : track;
              }),
            });
          }}
        />
      </SynthesisWaveSurfer>
    </GlassCard>
  );
}
