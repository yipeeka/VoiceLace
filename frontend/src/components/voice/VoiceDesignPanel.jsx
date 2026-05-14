import { useI18n } from "../../i18n/I18nProvider";

export default function VoiceDesignPanel({
  gender,
  style,
  accent,
  speed,
  onChangeGender,
  onChangeStyle,
  onChangeAccent,
  onChangeSpeed,
}) {
  const { t } = useI18n();
  return (
    <div className="voicePanel">
      <h3>{t("legacy.voiceDesign.title")}</h3>
      <p className="muted">{t("legacy.voiceDesign.subtitle")}</p>
      <div className="editorGrid">
        <input className="textInput" value={gender} onChange={(event) => onChangeGender(event.target.value)} placeholder={t("legacy.voiceDesign.placeholder.gender")} />
        <input className="textInput" value={style} onChange={(event) => onChangeStyle(event.target.value)} placeholder={t("legacy.voiceDesign.placeholder.style")} />
      </div>
      <div className="editorGrid">
        <input className="textInput" value={accent} onChange={(event) => onChangeAccent(event.target.value)} placeholder="accent" />
        <input className="textInput" value={speed} onChange={(event) => onChangeSpeed(event.target.value)} placeholder="speed" />
      </div>
    </div>
  );
}
