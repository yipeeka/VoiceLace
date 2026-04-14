import Select from "../ui/Select";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";

export default function SegmentEditorFields({ draft, onFieldChange, includeAdvanced = true, textMinHeight = 64 }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 120px", gap: 6 }}>
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
            onChange={(e) => onFieldChange("nonVerbalText", e.target.value)}
            placeholder="non_verbal，逗号分隔，例如：laugh, sigh"
          />
          <textarea
            className="textArea compactArea"
            value={draft?.ttsOverridesText || "{}"}
            onChange={(e) => onFieldChange("ttsOverridesText", e.target.value)}
            style={{ minHeight: 88, fontFamily: "monospace", fontSize: 12 }}
            placeholder='tts_overrides JSON，例如 {"speed":1.05}'
          />
        </>
      ) : null}
    </div>
  );
}
