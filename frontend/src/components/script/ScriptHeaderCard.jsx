import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function ScriptHeaderCard({
  currentProjectName,
  script,
  error,
  canEdit,
  fileInputRef,
  onExportJson,
  onImportClick,
  onImportJson,
}) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <h2>{t("legacy.script.header.title")}</h2>
      <p className="muted">
        {t("legacy.script.header.summary", {
          projectName: currentProjectName || t("project.unselected"),
          segmentCount: script.segments.length,
          characterCount: script.characters.length,
        })}
      </p>
      {script.characters.length ? (
        <div className="chipRow">
          {script.characters.map((character) => (
            <span key={character.name} className="statusBadge" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-primary)" }}>
              {character.name} · {character.appearance_count}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="errorText">{error}</div> : null}
      <div className="controlRow">
        <button type="button" className="primaryButton ghostButton" onClick={onExportJson} disabled={!script.segments.length}>
          {t("legacy.script.header.exportJson")}
        </button>
        <button type="button" className="primaryButton ghostButton" onClick={onImportClick} disabled={!canEdit}>
          {t("legacy.script.header.importJson")}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImportJson} />
      </div>
    </GlassCard>
  );
}
