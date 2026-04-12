import GlassCard from "../shared/GlassCard";

export default function ScriptHeaderCard({
  currentProjectName,
  script,
  error,
  canEdit,
  fileInputRef,
  onExportJson,
  onImportClick,
  onImportJson,
}) {
  return (
    <GlassCard>
      <h2>剧本编辑器</h2>
      <p className="muted">
        当前项目 {currentProjectName || "未选择"}。片段数 {script.segments.length}，角色数 {script.characters.length}。
      </p>
      {script.characters.length ? (
        <div className="chipRow">
          {script.characters.map((character) => (
            <span key={character.name} className="statusBadge" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-primary)" }}>
              {character.name} · {character.appearance_count}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="errorText">{error}</div> : null}
      <div className="controlRow">
        <button type="button" className="primaryButton ghostButton" onClick={onExportJson} disabled={!script.segments.length}>
          导出 JSON
        </button>
        <button type="button" className="primaryButton ghostButton" onClick={onImportClick} disabled={!canEdit}>
          导入 JSON
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImportJson} />
      </div>
    </GlassCard>
  );
}
