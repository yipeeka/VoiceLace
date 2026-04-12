import { useMemo } from "react";

export default function PromptEditor({ value, onChange, onReset, isLoading, defaultPrompt }) {
  const charCount = useMemo(() => value.length, [value]);

  return (
    <div className="promptEditor">
      <div className="segmentEditorHeader">
        <strong>提示词编辑器</strong>
        <span className="muted">{charCount} 字符</span>
      </div>
      <textarea
        className="textArea compactArea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="用于指导 LLM 解析剧本结构与角色信息"
      />
      <div className="controlRow">
        <button type="button" className="primaryButton ghostButton" disabled={isLoading || !defaultPrompt} onClick={onReset}>
          {isLoading ? "加载默认提示词..." : "恢复默认提示词"}
        </button>
      </div>
    </div>
  );
}
