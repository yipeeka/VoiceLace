import { useId, useMemo } from "react";

import Select from "../ui/Select";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";

export default function SegmentEditorFields({
  draft,
  onFieldChange,
  onTextCursorChange = null,
  includeAdvanced = true,
  textMinHeight = 64,
  speakerOptions = [],
  compact = false,
}) {
  const fieldId = useId();
  const knownSpeakerOptions = useMemo(() => {
    const map = new Map();
    map.set("narrator", { value: "narrator", label: "narrator" });
    (speakerOptions || []).forEach((item) => {
      if (!item?.value) return;
      map.set(item.value, item);
    });
    return Array.from(map.values());
  }, [speakerOptions]);

  const currentSpeaker = (draft?.speaker || "").trim();
  const isKnownSpeaker = knownSpeakerOptions.some((item) => item.value === currentSpeaker);
  const speakerSelectValue = isKnownSpeaker ? currentSpeaker : "__new__";
  const canEditSourceTiming = draft?.sourceBoundsStartMs !== null && draft?.sourceBoundsStartMs !== undefined
    && draft?.sourceBoundsEndMs !== null && draft?.sourceBoundsEndMs !== undefined;

  const resolvedSpeakerOptions = useMemo(() => {
    if (knownSpeakerOptions.some((item) => item.value === "__new__")) {
      return knownSpeakerOptions;
    }
    return [
      ...knownSpeakerOptions,
      { value: "__new__", label: "+ 添加新角色" },
    ];
  }, [knownSpeakerOptions]);

  return (
    <div className={`segmentEditorFields${compact ? " compact" : ""}`}>
      <div className={`segmentEditorFieldGrid${compact ? " compact" : ""}`}>
        <label className="visuallyHidden" htmlFor={`${fieldId}-speaker`}>
          角色
        </label>
        <Select
          id={`${fieldId}-speaker`}
          aria-label="角色"
          value={speakerSelectValue}
          onValueChange={(value) => {
            if (value === "__new__") {
              onFieldChange("speaker", isKnownSpeaker ? "" : currentSpeaker);
              return;
            }
            onFieldChange("speaker", value || "narrator");
          }}
          options={resolvedSpeakerOptions}
        />
        <label className="visuallyHidden" htmlFor={`${fieldId}-type`}>
          片段类型
        </label>
        <Select
          id={`${fieldId}-type`}
          aria-label="片段类型"
          value={draft?.type || "dialogue"}
          onValueChange={(value) => onFieldChange("type", value)}
          options={TYPE_OPTIONS}
        />
        <label className="visuallyHidden" htmlFor={`${fieldId}-emotion`}>
          情绪
        </label>
        <Select
          id={`${fieldId}-emotion`}
          aria-label="情绪"
          value={draft?.emotion || "neutral"}
          onValueChange={(value) => onFieldChange("emotion", value)}
          options={EMOTION_OPTIONS}
        />
      </div>
      {speakerSelectValue === "__new__" ? (
        <input
          id={`${fieldId}-new-speaker`}
          className="textInput"
          name="speaker"
          aria-label="新角色名"
          autoComplete="off"
          spellCheck={false}
          value={currentSpeaker}
          onChange={(e) => onFieldChange("speaker", e.target.value)}
          placeholder="输入新角色名…"
        />
      ) : null}
      <textarea
        id={`${fieldId}-text`}
        className="textArea compactArea"
        name="segmentText"
        aria-label="片段文本"
        value={draft?.text || ""}
        onChange={(e) => onFieldChange("text", e.target.value)}
        onClick={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        onKeyUp={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        onSelect={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        style={{ minHeight: textMinHeight }}
      />
      {includeAdvanced ? (
        <>
          {canEditSourceTiming ? (
            <div className={`segmentTimingEditor${compact ? " compact" : ""}`}>
              <div className="formGroup">
                <label className="formLabel" htmlFor={`${fieldId}-source-start`}>
                  起始时间
                </label>
                <input
                  id={`${fieldId}-source-start`}
                  className="textInput"
                  name="sourceStart"
                  autoComplete="off"
                  value={draft?.sourceStartText || ""}
                  onChange={(e) => onFieldChange("sourceStartText", e.target.value)}
                  placeholder="HH:MM:SS.mmm"
                />
              </div>
              <div className="formGroup">
                <label className="formLabel" htmlFor={`${fieldId}-source-end`}>
                  终止时间
                </label>
                <input
                  id={`${fieldId}-source-end`}
                  className="textInput"
                  name="sourceEnd"
                  autoComplete="off"
                  value={draft?.sourceEndText || ""}
                  onChange={(e) => onFieldChange("sourceEndText", e.target.value)}
                  placeholder="HH:MM:SS.mmm"
                />
              </div>
              <div className="muted segmentTimingHint">
                只能在原时间范围内收窄，保存后会同步更新片段时间码。
              </div>
            </div>
          ) : null}
          <input
            id={`${fieldId}-non-verbal`}
            className="textInput"
            name="nonVerbal"
            aria-label="non_verbal 只读"
            autoComplete="off"
            spellCheck={false}
            value={draft?.nonVerbalText || ""}
            readOnly
            aria-readonly="true"
            placeholder="non_verbal（只读）…"
            title="non_verbal 当前为只读显示"
          />
          <textarea
            id={`${fieldId}-tts-overrides`}
            className="textArea compactArea"
            name="ttsOverrides"
            aria-label="tts_overrides JSON"
            autoComplete="off"
            spellCheck={false}
            value={draft?.ttsOverridesText || "{}"}
            onChange={(e) => onFieldChange("ttsOverridesText", e.target.value)}
            style={{ minHeight: 88, fontFamily: "monospace", fontSize: 12 }}
            placeholder='例如 {"speed":1.1}…'
          />
          <div style={{ fontSize: 12, color: "var(--textMuted)" }}>
            支持字段：
            <code>speed</code>
            、
            <code>duration</code>
            、
            <code>denoise</code>
            、
            <code>num_step</code>
            、
            <code>guidance_scale</code>
            。示例：
            <code>{"{\"speed\":1.1}"}</code>
            。
            <code>duration</code>
            与
            <code>speed</code>
            同时存在时，以
            <code>duration</code>
            为准；不支持的字段会在重生成时报错。
          </div>
        </>
      ) : null}
    </div>
  );
}
