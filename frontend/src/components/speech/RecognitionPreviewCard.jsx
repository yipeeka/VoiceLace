import { WandSparkles } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";

export default function RecognitionPreviewCard({
  alignments,
  canInsert,
  isBusy,
  onAppendToText,
  onClearResult,
  onReplaceText,
  onPreviewTextChange,
  onShowTimelineChange,
  onSpeakerMapEntryChange,
  plainText,
  previewText,
  showTimeline,
  speakerLabels,
  speakerMap,
  transcript,
}) {
  const hasSpeakerMappings = speakerLabels && Array.isArray(alignments) && alignments.length;

  return (
    <GlassCard>
      <div className="sectionHeader">
        <h2 className="cardTitle">
          <WandSparkles size={16} />
          识别预览
        </h2>
        <label className="controlRow inlineCheckRow">
          <input
            type="checkbox"
            checked={showTimeline}
            onChange={(event) => onShowTimelineChange(event.target.checked)}
            disabled={isBusy || !alignments.length}
          />
          <span>显示时间轴</span>
        </label>
      </div>
      <textarea
        className="textArea speechPreviewTextArea"
        value={previewText}
        onChange={(event) => onPreviewTextChange(event.target.value)}
        placeholder="识别结果将显示在这里。"
      />
      {hasSpeakerMappings ? (
        <div className="listStack speechSpeakerMapList">
          <div className="muted">说话人映射（空值会回退原标签，可重名用于合并）</div>
          <div className="muted">当前预览由分段时间轴实时生成，可直接改右侧目标名。</div>
          {Object.keys(speakerMap || {}).map((source) => (
            <div key={source} className="editorGrid two">
              <div className="muted">{source}</div>
              <input
                className="textInput"
                value={speakerMap?.[source] ?? ""}
                onChange={(event) => onSpeakerMapEntryChange(source, event.target.value)}
                placeholder={source}
                disabled={isBusy}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="controlRow">
        <Button variant="primary" onClick={onAppendToText} disabled={!canInsert}>
          追加到文本输入
        </Button>
        <Button variant="secondary" onClick={onReplaceText} disabled={!canInsert}>
          替换文本输入
        </Button>
        <Button variant="ghost" onClick={onClearResult} disabled={!transcript && !plainText && !previewText}>
          清空结果
        </Button>
      </div>
    </GlassCard>
  );
}
