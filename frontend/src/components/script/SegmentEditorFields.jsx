import { useMemo } from "react";

import Select from "../ui/Select";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";
import { useI18n } from "../../i18n/I18nProvider";

export default function SegmentEditorFields({
  draft,
  onFieldChange,
  onTextCursorChange = null,
  includeAdvanced = true,
  textMinHeight = 64,
  speakerOptions = [],
  compact = false,
}) {
  const { t } = useI18n();
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
      { value: "__new__", label: t("script.segmentEditor.addNewCharacter") },
    ],
    [knownSpeakerOptions, t],
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
          placeholder={t("script.segmentEditor.newCharacterPlaceholder")}
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
            placeholder={t("script.segmentEditor.nonVerbalReadonlyPlaceholder")}
            title={t("script.segmentEditor.nonVerbalReadonlyTitle")}
          />
          <textarea
            className="textArea compactArea"
            value={draft?.ttsOverridesText || "{}"}
            onChange={(e) => onFieldChange("ttsOverridesText", e.target.value)}
            style={{ minHeight: 88, fontFamily: "monospace", fontSize: 12 }}
            placeholder={t("script.segmentEditor.ttsOverridesPlaceholder")}
          />
          <div style={{ fontSize: 12, color: "var(--textMuted)" }}>
            {t("script.segmentEditor.supportedFields")}
            <code>speed</code>
            、
            <code>duration</code>
            、
            <code>denoise</code>
            、
            <code>num_step</code>
            、
            <code>guidance_scale</code>
            。{t("script.segmentEditor.exampleLabel")}
            <code>{"{\"speed\":1.1}"}</code>
            。
            <code>duration</code>
            {t("script.segmentEditor.and")}
            <code>speed</code>
            {t("script.segmentEditor.whenBothExist")}
            <code>duration</code>
            {t("script.segmentEditor.durationPriority")}
          </div>
        </>
      ) : null}
    </div>
  );
}
