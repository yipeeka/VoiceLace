import GlassCard from "../shared/GlassCard";
import SynthesisWaveSurfer from "../shared/SynthesisWaveSurfer";

export default function SynthesisFullAudioCard({
  projectId,
  fullAudioUrl,
  audioVariant = "raw",
  segments,
  gapDurationMs,
  onCurrentTimeChange,
}) {
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
        height={80}
        onCurrentTimeChange={onCurrentTimeChange}
      />
    </GlassCard>
  );
}
