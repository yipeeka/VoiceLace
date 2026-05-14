import { useI18n } from "../../i18n/I18nProvider";

export default function VoicePresetCardList({ presets, isSaving, onPreview, onDelete }) {
  const { t } = useI18n();
  if (!presets.length) {
    return <div className="emptyState">{t("legacy.voicePreset.empty")}</div>;
  }

  return (
    <div className="listStack">
      {presets.map((preset) => (
        <div key={preset.id} className="segmentEditorCard">
          <div className="segmentEditorHeader">
            <strong>{preset.name}</strong>
            <span className="muted">{preset.voice_mode}</span>
          </div>
          <div className="segmentMetaRow">
            <span className="statusBadge" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-primary)" }}>
              {preset.gender || "unspecified"}
            </span>
            <span className="muted">{t("legacy.voicePreset.speed", { speed: preset.speed })}</span>
          </div>
          <p className="segmentText">{preset.description || t("legacy.voicePreset.noDescription")}</p>
          <div className="controlRow">
            <button type="button" className="primaryButton ghostButton" disabled={isSaving} onClick={() => onPreview(preset.id)}>
              {t("voice.previewShort")}
            </button>
            <button type="button" className="primaryButton ghostButton dangerButton" disabled={isSaving} onClick={() => onDelete(preset.id)}>
              {t("common.delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
