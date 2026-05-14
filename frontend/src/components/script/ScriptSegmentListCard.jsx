import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function ScriptSegmentListCard({
  segments,
  editingId,
  drafts,
  canEdit,
  isSaving,
  onBeginEdit,
  onUpdateDraft,
  onSaveDraft,
  onCancelEdit,
  onDelete,
}) {
  const { t } = useI18n();

  return (
    <GlassCard>
      <h2>{t("script.segmentList")}</h2>
      <div className="listStack">
        {segments.length ? (
          segments.map((segment) => {
            const isEditing = editingId === segment.id;
            const draft = drafts[segment.id] || segment;
            return (
              <div key={segment.id} className="segmentEditorCard">
                <div className="segmentEditorHeader">
                  <strong>#{segment.index + 1}</strong>
                  <span className="muted">{segment.id.slice(0, 8)}</span>
                </div>
                {isEditing ? (
                  <>
                    <div className="editorGrid">
                      <select className="textInput" value={draft.type} onChange={(event) => onUpdateDraft(segment.id, "type", event.target.value)}>
                        <option value="dialogue">{t("script.segmentType.dialogue")}</option>
                        <option value="narration">{t("script.segmentType.narration")}</option>
                        <option value="direction">{t("script.segmentType.direction")}</option>
                      </select>
                      <input
                        className="textInput"
                        value={draft.speaker}
                        onChange={(event) => onUpdateDraft(segment.id, "speaker", event.target.value)}
                        placeholder={t("script.segmentListCard.speakerPlaceholder")}
                      />
                    </div>
                    <textarea className="textArea compactArea" value={draft.text} onChange={(event) => onUpdateDraft(segment.id, "text", event.target.value)} />
                    <div className="controlRow">
                      <button type="button" className="primaryButton" disabled={isSaving || !draft.text.trim()} onClick={() => onSaveDraft(segment.id)}>
                        {t("common.save")}
                      </button>
                      <button type="button" className="primaryButton ghostButton" onClick={() => onCancelEdit(segment.id)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="segmentMetaRow">
                      <span className="statusBadge" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-primary)" }}>
                        {segment.type}
                      </span>
                      <strong>{segment.speaker}</strong>
                    </div>
                    <p className="segmentText">{segment.text}</p>
                    <div className="controlRow">
                      <button type="button" className="primaryButton ghostButton" disabled={!canEdit || isSaving} onClick={() => onBeginEdit(segment)}>
                        {t("common.edit")}
                      </button>
                      <button type="button" className="primaryButton ghostButton dangerButton" disabled={!canEdit || isSaving} onClick={() => onDelete(segment.id)}>
                        {t("common.delete")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="emptyState">{t("script.empty.noSegmentsDesc")}</div>
        )}
      </div>
    </GlassCard>
  );
}
