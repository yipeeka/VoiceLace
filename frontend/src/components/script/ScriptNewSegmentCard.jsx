import GlassCard from "../shared/GlassCard";

export default function ScriptNewSegmentCard({ newSegment, setNewSegment, canEdit, isSaving, onAddSegment }) {
  return (
    <GlassCard>
      <h2>新增片段</h2>
      <div className="editorGrid">
        <select className="textInput" value={newSegment.type} onChange={(event) => setNewSegment((state) => ({ ...state, type: event.target.value }))}>
          <option value="dialogue">dialogue</option>
          <option value="narration">narration</option>
          <option value="direction">direction</option>
        </select>
        <input
          className="textInput"
          value={newSegment.speaker}
          onChange={(event) => setNewSegment((state) => ({ ...state, speaker: event.target.value }))}
          placeholder="角色名 / narrator"
        />
      </div>
      <textarea
        className="textArea compactArea"
        value={newSegment.text}
        onChange={(event) => setNewSegment((state) => ({ ...state, text: event.target.value }))}
        placeholder="输入新的台词或旁白"
      />
      <div className="controlRow">
        <button type="button" className="primaryButton" disabled={!canEdit || isSaving || !newSegment.text.trim()} onClick={onAddSegment}>
          {isSaving ? "保存中..." : "新增片段"}
        </button>
      </div>
    </GlassCard>
  );
}
