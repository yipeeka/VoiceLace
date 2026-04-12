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
  return (
    <div className="voicePanel">
      <h3>设计模式</h3>
      <p className="muted">通过属性描述直接生成目标音色，适合没有参考音频的角色。</p>
      <div className="editorGrid">
        <input className="textInput" value={gender} onChange={(event) => onChangeGender(event.target.value)} placeholder="gender，如 female" />
        <input className="textInput" value={style} onChange={(event) => onChangeStyle(event.target.value)} placeholder="style，如 whisper" />
      </div>
      <div className="editorGrid">
        <input className="textInput" value={accent} onChange={(event) => onChangeAccent(event.target.value)} placeholder="accent" />
        <input className="textInput" value={speed} onChange={(event) => onChangeSpeed(event.target.value)} placeholder="speed" />
      </div>
    </div>
  );
}
