import GlassCard from "../shared/GlassCard";

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
  return (
    <GlassCard>
      <h2>片段列表</h2>
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
                        <option value="dialogue">dialogue</option>
                        <option value="narration">narration</option>
                        <option value="direction">direction</option>
                      </select>
                      <input
                        className="textInput"
                        value={draft.speaker}
                        onChange={(event) => onUpdateDraft(segment.id, "speaker", event.target.value)}
                        placeholder="角色名"
                      />
                    </div>
                    <textarea className="textArea compactArea" value={draft.text} onChange={(event) => onUpdateDraft(segment.id, "text", event.target.value)} />
                    <div className="controlRow">
                      <button type="button" className="primaryButton" disabled={isSaving || !draft.text.trim()} onClick={() => onSaveDraft(segment.id)}>
                        保存
                      </button>
                      <button type="button" className="primaryButton ghostButton" onClick={() => onCancelEdit(segment.id)}>
                        取消
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
                        编辑
                      </button>
                      <button type="button" className="primaryButton ghostButton dangerButton" disabled={!canEdit || isSaving} onClick={() => onDelete(segment.id)}>
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="emptyState">还没有剧本片段，先在文本输入页发起解析。</div>
        )}
      </div>
    </GlassCard>
  );
}
