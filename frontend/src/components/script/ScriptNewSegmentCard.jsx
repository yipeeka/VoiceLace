import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function ScriptNewSegmentCard({ newSegment, setNewSegment, canEdit, isSaving, onAddSegment }) {
  const { t } = useI18n();

  return (
    <GlassCard>
      <h2>{t("script.newSegmentCard.title")}</h2>
      <div className="editorGrid">
        <select className="textInput" value={newSegment.type} onChange={(event) => setNewSegment((state) => ({ ...state, type: event.target.value }))}>
          <option value="dialogue">{t("script.segmentType.dialogue")}</option>
          <option value="narration">{t("script.segmentType.narration")}</option>
          <option value="direction">{t("script.segmentType.direction")}</option>
        </select>
        <input
          className="textInput"
          value={newSegment.speaker}
          onChange={(event) => setNewSegment((state) => ({ ...state, speaker: event.target.value }))}
          placeholder={t("script.newSegmentCard.speakerPlaceholder")}
        />
      </div>
      <textarea
        className="textArea compactArea"
        value={newSegment.text}
        onChange={(event) => setNewSegment((state) => ({ ...state, text: event.target.value }))}
        placeholder={t("script.newSegmentCard.textPlaceholder")}
      />
      <div className="controlRow">
        <button type="button" className="primaryButton" disabled={!canEdit || isSaving || !newSegment.text.trim()} onClick={onAddSegment}>
          {isSaving ? t("common.saving") : t("script.newSegmentCard.addAction")}
        </button>
      </div>
    </GlassCard>
  );
}
