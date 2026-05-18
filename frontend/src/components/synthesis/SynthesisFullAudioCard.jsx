import { useEffect, useState } from "react";

import GlassCard from "../shared/GlassCard";
import SynthesisWaveSurfer from "../shared/SynthesisWaveSurfer";

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
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSignal, setPlaySignal] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);

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

  return (
    <GlassCard>
      <h2 className="cardTitle">完整音频</h2>
      <SynthesisWaveSurfer
        projectId={projectId}
        audioUrl={fullAudioUrl}
        audioVariant={audioVariant}
        segments={segments}
        gapDurationMs={gapDurationMs}
        useSourceTimeline={useSourceTimeline}
        height={80}
        onCurrentTimeChange={onCurrentTimeChange}
        autoPlaySignal={playSignal}
        pauseSignal={pauseSignal}
        seekToSeconds={seekToSeconds}
        seekSignal={seekSignal}
        playOnSeek={playOnSeek}
        onPlayStateChange={setIsPlaying}
      />
    </GlassCard>
  );
}
