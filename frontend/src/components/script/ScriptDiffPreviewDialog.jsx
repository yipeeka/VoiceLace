import { Eye } from "lucide-react";

import { Dialog, DialogContent } from "../ui/Dialog";
import Button from "../ui/Button";
import { buildScriptDiffSummary } from "../../utils/scriptDiff";
import { useI18n } from "../../i18n/I18nProvider";

function formatChangedFields(fields) {
  const values = Array.isArray(fields) ? fields : [];
  return values.length ? values.join(", ") : "-";
}

export default function ScriptDiffPreviewDialog({
  open,
  onOpenChange,
  diff,
}) {
  const { t } = useI18n();
  const summary = buildScriptDiffSummary(diff);
  const added = diff?.addedSegments || [];
  const removed = diff?.removedSegments || [];
  const modified = diff?.modifiedSegments || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("script.diff.title")}
        description={t("script.diff.description")}
        className="scriptDiffDialog"
      >
        <div className="controlRow">
          <span className="statusBadge default">{t("script.diff.badge.added", { count: summary.added })}</span>
          <span className="statusBadge default">{t("script.diff.badge.removed", { count: summary.removed })}</span>
          <span className="statusBadge default">{t("script.diff.badge.modified", { count: summary.modified })}</span>
          <span className={`statusBadge ${summary.reordered ? "warning" : "default"}`}>
            {summary.reordered ? t("script.diff.badge.reorderedYes") : t("script.diff.badge.reorderedNo")}
          </span>
        </div>

        <div className="listStack">
          {added.map((item) => (
            <div key={`add-${item.id}`} className="statRow">
              <span>{t("script.diff.row.added", { index: item.index + 1, speaker: item.speaker })}</span>
              <span className="muted">{item.textPreview}</span>
            </div>
          ))}
          {removed.map((item) => (
            <div key={`rm-${item.id}`} className="statRow">
              <span>{t("script.diff.row.removed", { index: item.index + 1, speaker: item.speaker })}</span>
              <span className="muted">{item.textPreview}</span>
            </div>
          ))}
          {modified.map((item) => (
            <div key={`mod-${item.id}`} className="statRow" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>{t("script.diff.row.modified", { index: item.index + 1, speaker: item.afterSpeaker })}</span>
                <span className="muted">{t("script.diff.fieldLabel")}: {formatChangedFields(item.changedFields)}</span>
              </div>
              <div className="muted">{t("script.diff.before")}: {item.beforeTextPreview}</div>
              <div className="muted">{t("script.diff.after")}: {item.afterTextPreview}</div>
            </div>
          ))}
          {!summary.hasChanges ? (
            <div className="emptyState">{t("script.diff.empty")}</div>
          ) : null}
        </div>

        <div className="controlRow" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" icon={Eye} onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
