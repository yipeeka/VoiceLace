import { useMemo } from "react";

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

  const resolvedSpeakerOptions = useMemo(
    () => [
      ...knownSpeakerOptions,
      { value: "__new__", label: "+ 添加新角色" },
    ],
    [knownSpeakerOptions],
  );

  return (
    <div className={`segmentEditorFields${compact ? " compact" : ""}`}>
      <div className={`segmentEditorFieldGrid${compact ? " compact" : ""}`}>
        <Select
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
        <Select
          value={draft?.type || "dialogue"}
          onValueChange={(value) => onFieldChange("type", value)}
          options={TYPE_OPTIONS}
        />
        <Select
          value={draft?.emotion || "neutral"}
          onValueChange={(value) => onFieldChange("emotion", value)}
          options={EMOTION_OPTIONS}
        />
      </div>
      {speakerSelectValue === "__new__" ? (
        <input
          className="textInput"
          value={currentSpeaker}
          onChange={(e) => onFieldChange("speaker", e.target.value)}
          placeholder="输入新角色名（留空保存后会回退 narrator）"
        />
      ) : null}
      <textarea
        className="textArea compactArea"
        value={draft?.text || ""}
        onChange={(e) => onFieldChange("text", e.target.value)}
        onClick={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        onKeyUp={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        onSelect={(e) => onTextCursorChange?.(e.target.selectionStart ?? 0)}
        style={{ minHeight: textMinHeight }}
      />
      {includeAdvanced ? (
        <>
          <input
            className="textInput"
            value={draft?.nonVerbalText || ""}
            readOnly
            aria-readonly="true"
            placeholder="non_verbal（只读）"
            title="non_verbal 当前为只读显示"
          />
          <textarea
            className="textArea compactArea"
            value={draft?.ttsOverridesText || "{}"}
            onChange={(e) => onFieldChange("ttsOverridesText", e.target.value)}
            style={{ minHeight: 88, fontFamily: "monospace", fontSize: 12 }}
            placeholder='tts_overrides JSON（仅支持 speed/duration/denoise/num_step/guidance_scale）'
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
