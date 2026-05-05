import { Eye } from "lucide-react";

import { Dialog, DialogContent } from "../ui/Dialog";
import Button from "../ui/Button";
import { buildScriptDiffSummary } from "../../utils/scriptDiff";

function formatChangedFields(fields) {
  const values = Array.isArray(fields) ? fields : [];
  return values.length ? values.join(", ") : "-";
}

export default function ScriptDiffPreviewDialog({
  open,
  onOpenChange,
  diff,
}) {
  const summary = buildScriptDiffSummary(diff);
  const added = diff?.addedSegments || [];
  const removed = diff?.removedSegments || [];
  const modified = diff?.modifiedSegments || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="保存前差异预览"
        description="此预览只展示摘要，不会自动保存。"
        className="scriptDiffDialog"
      >
        <div className="controlRow">
          <span className="statusBadge default">新增 {summary.added}</span>
          <span className="statusBadge default">删除 {summary.removed}</span>
          <span className="statusBadge default">修改 {summary.modified}</span>
          <span className={`statusBadge ${summary.reordered ? "warning" : "default"}`}>
            {summary.reordered ? "存在重排" : "无重排"}
          </span>
        </div>

        <div className="listStack">
          {added.map((item) => (
            <div key={`add-${item.id}`} className="statRow">
              <span>新增 #{item.index + 1} · {item.speaker}</span>
              <span className="muted">{item.textPreview}</span>
            </div>
          ))}
          {removed.map((item) => (
            <div key={`rm-${item.id}`} className="statRow">
              <span>删除 #{item.index + 1} · {item.speaker}</span>
              <span className="muted">{item.textPreview}</span>
            </div>
          ))}
          {modified.map((item) => (
            <div key={`mod-${item.id}`} className="statRow" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>修改 #{item.index + 1} · {item.afterSpeaker}</span>
                <span className="muted">字段: {formatChangedFields(item.changedFields)}</span>
              </div>
              <div className="muted">旧: {item.beforeTextPreview}</div>
              <div className="muted">新: {item.afterTextPreview}</div>
            </div>
          ))}
          {!summary.hasChanges ? (
            <div className="emptyState">当前没有未保存差异。</div>
          ) : null}
        </div>

        <div className="controlRow" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" icon={Eye} onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
