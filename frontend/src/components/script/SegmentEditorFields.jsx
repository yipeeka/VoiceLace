import Select from "../ui/Select";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";

export default function SegmentEditorFields({ draft, onFieldChange, includeAdvanced = true, textMinHeight = 64 }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(110px, 1fr) minmax(120px, 0.8fr) minmax(190px, 1.35fr)",
          gap: 6,
        }}
      >
        <input
          className="textInput"
          value={draft?.speaker || ""}
          onChange={(e) => onFieldChange("speaker", e.target.value)}
          placeholder="角色"
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
      <textarea
        className="textArea compactArea"
        value={draft?.text || ""}
        onChange={(e) => onFieldChange("text", e.target.value)}
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
