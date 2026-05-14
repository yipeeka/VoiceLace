import { useI18n } from "../../i18n/I18nProvider";

export default function VoiceClonePanel({
  refAudioPath,
  refText,
  uploadedRefAudioPath,
  transcribedRefText,
  isTranscribing,
  onUploadRefAudio,
  onTranscribe,
  onChangeRefAudioPath,
  onChangeRefText,
}) {
  const { t } = useI18n();
  return (
    <div className="voicePanel">
      <h3>{t("legacy.voiceClone.title")}</h3>
      <p className="muted">{t("legacy.voiceClone.subtitle")}</p>
      <div className="editorGrid">
        <input className="textInput" type="file" accept="audio/*" onChange={onUploadRefAudio} />
        <button type="button" className="primaryButton ghostButton" disabled={!refAudioPath || isTranscribing} onClick={onTranscribe}>
          {isTranscribing ? t("voice.transcribing") : t("voice.asrTranscribe")}
        </button>
      </div>
      <input className="textInput" value={refAudioPath} onChange={(event) => onChangeRefAudioPath(event.target.value)} placeholder="ref_audio_path" />
      <textarea
        className="textArea compactArea"
        value={refText}
        onChange={(event) => onChangeRefText(event.target.value)}
        placeholder={t("legacy.voiceClone.refTextPlaceholder")}
      />
      {uploadedRefAudioPath ? <div className="muted">{t("legacy.voiceClone.uploaded")}: {uploadedRefAudioPath}</div> : null}
      {transcribedRefText ? <div className="muted">{t("legacy.voiceClone.latestTranscribed")}: {transcribedRefText}</div> : null}
    </div>
  );
}
