import AudioPlayer from "../shared/AudioPlayer";
import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function VoiceAssignmentCard({
  characters,
  assignments,
  presetOptions,
  currentProjectId,
  isSaving,
  sampleText,
  previewAudioUrl,
  onAssignVoice,
  onSaveAssignments,
  onSampleTextChange,
}) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <h2>{t("voice.assignments")}</h2>
      <p className="muted">{t("voice.assignmentsDesc")}</p>
      {characters.length ? (
        <div className="listStack">
          {characters.map((character) => (
            <div key={character.name} className="segmentEditorCard">
              <div className="segmentEditorHeader">
                <strong>{character.name}</strong>
                <span className="muted">{t("voice.appearanceCount", { count: character.appearance_count })}</span>
              </div>
              <select className="textInput" value={assignments[character.name] || ""} onChange={(event) => onAssignVoice(character.name, event.target.value)}>
                {presetOptions.map((preset) => (
                  <option key={preset.id || "none"} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="controlRow">
            <button type="button" className="primaryButton" disabled={!currentProjectId || isSaving} onClick={onSaveAssignments}>
              {t("voice.saveAssignments")}
            </button>
          </div>
        </div>
      ) : (
        <div className="emptyState">{t("voice.empty.noCharactersDesc")}</div>
      )}

      <h2 style={{ marginTop: 28 }}>{t("legacy.voiceAssignment.previewPlayer")}</h2>
      <textarea className="textArea compactArea" value={sampleText} onChange={(event) => onSampleTextChange(event.target.value)} />
      {previewAudioUrl ? (
        <div style={{ marginTop: 14 }}>
          <AudioPlayer audioUrl={previewAudioUrl} />
        </div>
      ) : (
        <div className="emptyState">{t("legacy.voiceAssignment.emptyPreview")}</div>
      )}
    </GlassCard>
  );
}
