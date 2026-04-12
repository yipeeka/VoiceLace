export default function VoicePresetCardList({ presets, isSaving, onPreview, onDelete }) {
  if (!presets.length) {
    return <div className="emptyState">还没有声音预设，先创建一个。</div>;
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
            <span className="muted">speed {preset.speed}</span>
          </div>
          <p className="segmentText">{preset.description || "暂无描述。"}</p>
          <div className="controlRow">
            <button type="button" className="primaryButton ghostButton" disabled={isSaving} onClick={() => onPreview(preset.id)}>
              试听
            </button>
            <button type="button" className="primaryButton ghostButton dangerButton" disabled={isSaving} onClick={() => onDelete(preset.id)}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
