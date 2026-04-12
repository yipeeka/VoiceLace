export default function VoiceClonePanel({
  refAudioPath,
  refText,
  uploadedRefAudioPath,
  transcribedRefText,
  isTranscribing,
  onUploadRefAudio,
  onTranscribe,
  onChangeRefAudioPath,
  onChangeRefText,
}) {
  return (
    <div className="voicePanel">
      <h3>克隆模式</h3>
      <p className="muted">上传参考音频并自动转写，生成 ref_text 供克隆推理使用。</p>
      <div className="editorGrid">
        <input className="textInput" type="file" accept="audio/*" onChange={onUploadRefAudio} />
        <button type="button" className="primaryButton ghostButton" disabled={!refAudioPath || isTranscribing} onClick={onTranscribe}>
          {isTranscribing ? "转写中..." : "ASR 转写"}
        </button>
      </div>
      <input className="textInput" value={refAudioPath} onChange={(event) => onChangeRefAudioPath(event.target.value)} placeholder="ref_audio_path" />
      <textarea
        className="textArea compactArea"
        value={refText}
        onChange={(event) => onChangeRefText(event.target.value)}
        placeholder="ref_text（可由 ASR 自动填充）"
      />
      {uploadedRefAudioPath ? <div className="muted">已上传: {uploadedRefAudioPath}</div> : null}
      {transcribedRefText ? <div className="muted">最新转写: {transcribedRefText}</div> : null}
    </div>
  );
}
