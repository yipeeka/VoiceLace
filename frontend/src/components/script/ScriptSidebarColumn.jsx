import { Users } from "lucide-react";

import CharacterBadge from "../shared/CharacterBadge";
import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import SegmentEditorFields from "./SegmentEditorFields";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nProvider";

export default function ScriptSidebarColumn({
  characters,
  totalSegments,
  activeSpeakerFilter = "all",
  onSelectSpeaker = null,
  hasUnsavedChanges = false,
  actionContent = null,
  error = "",
  newSegment,
  newSegmentSpeakerOptions,
  canEdit,
  isSaving,
  insertAfterLabel = "",
  onClearInsertAnchor = null,
  onNewSegmentFieldChange,
  onAddSegment,
  addButtonLabel = "",
}) {
  const { t } = useI18n();
  const isFilterable = typeof onSelectSpeaker === "function";
  const resolvedAddButtonLabel = addButtonLabel || t("synth.addSegment");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GlassCard>
        <h2 className="cardTitle"><Users size={16} /> {t("script.sidebar.characters")}</h2>
        {characters.length ? (
          <div className="listStack">
            <button
              type="button"
              className={`statRow ${isFilterable ? "statRowButton" : ""} ${activeSpeakerFilter === "all" ? "active" : ""}`}
              onClick={isFilterable ? () => onSelectSpeaker("all") : undefined}
              disabled={!isFilterable}
            >
              <span>{t("script.sidebar.total")}</span>
              <strong>{t("script.sidebar.segmentCount", { count: totalSegments })}</strong>
            </button>
            {characters.map(({ name, count }) => (
              <button
                key={name}
                type="button"
                className={`statRow ${isFilterable ? "statRowButton" : ""} ${activeSpeakerFilter === name ? "active" : ""}`}
                onClick={isFilterable ? () => onSelectSpeaker(name) : undefined}
                disabled={!isFilterable}
                title={name}
              >
                <CharacterBadge name={name} />
                <span className="muted" style={{ marginLeft: "auto" }}>
                  {t("script.sidebar.segmentCount", { count })}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title={t("script.sidebar.emptyCharactersTitle")} description={t("script.sidebar.emptyCharactersDesc")} />
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">{t("script.sidebar.actions")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hasUnsavedChanges ? (
            <div className="statusBadge warning">{t("script.sidebar.unsavedChanges")}</div>
          ) : (
            <div className="statusBadge success">{t("synth.saved")}</div>
          )}
          {actionContent}
        </div>
        {error ? <div className="errorText">⚠ {error}</div> : null}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">{t("script.sidebar.newSegment")}</h2>
        <div className="controlRow" style={{ justifyContent: "space-between" }}>
          <span className="muted">{insertAfterLabel || t("script.sidebar.appendToEnd")}</span>
          {insertAfterLabel && onClearInsertAnchor ? (
            <Button variant="ghost" size="sm" onClick={onClearInsertAnchor}>
              {t("script.sidebar.switchToAppendEnd")}
            </Button>
          ) : null}
        </div>
        <SegmentEditorFields
          draft={newSegment}
          includeAdvanced={false}
          compact
          speakerOptions={newSegmentSpeakerOptions}
          textMinHeight={72}
          onFieldChange={onNewSegmentFieldChange}
        />
        <Button
          variant="primary"
          disabled={!canEdit || isSaving || !newSegment?.text?.trim()}
          onClick={onAddSegment}
        >
          {resolvedAddButtonLabel}
        </Button>
      </GlassCard>
    </div>
  );
}
