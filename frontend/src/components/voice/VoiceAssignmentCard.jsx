import AudioPlayer from "../shared/AudioPlayer";
import GlassCard from "../shared/GlassCard";

export default function VoiceAssignmentCard({
  characters,
  assignments,
  presetOptions,
  currentProjectId,
  isSaving,
  sampleText,
  previewAudioUrl,
  onAssignVoice,
  onSaveAssignments,
  onSampleTextChange,
}) {
  return (
    <GlassCard>
      <h2>角色分配</h2>
      <p className="muted">把当前项目中的角色绑定到声音预设，并保存到项目配置里。</p>
      {characters.length ? (
        <div className="listStack">
          {characters.map((character) => (
            <div key={character.name} className="segmentEditorCard">
              <div className="segmentEditorHeader">
                <strong>{character.name}</strong>
                <span className="muted">出场 {character.appearance_count}</span>
              </div>
              <select className="textInput" value={assignments[character.name] || ""} onChange={(event) => onAssignVoice(character.name, event.target.value)}>
                {presetOptions.map((preset) => (
                  <option key={preset.id || "none"} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="controlRow">
            <button type="button" className="primaryButton" disabled={!currentProjectId || isSaving} onClick={onSaveAssignments}>
              保存角色分配
            </button>
          </div>
        </div>
      ) : (
        <div className="emptyState">当前项目还没有角色，先完成文本解析。</div>
      )}

      <h2 style={{ marginTop: 28 }}>试听播放器</h2>
      <textarea className="textArea compactArea" value={sampleText} onChange={(event) => onSampleTextChange(event.target.value)} />
      {previewAudioUrl ? (
        <div style={{ marginTop: 14 }}>
          <AudioPlayer audioUrl={previewAudioUrl} />
        </div>
      ) : (
        <div className="emptyState">选择一个预设并点击“试听”后，这里会出现播放器。</div>
      )}
    </GlassCard>
  );
}
