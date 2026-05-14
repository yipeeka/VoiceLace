import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function TextWorkspaceCard({
  projectName,
  setProjectName,
  currentProject,
  projects,
  sourceText,
  setSourceText,
  isParsing,
  parseProgress,
  error,
  onCreateProject,
  onSelectProject,
  onFillDemo,
  onParse,
  onCancelParse,
}) {
  const { t } = useI18n();

  return (
    <GlassCard>
      <h2>{t("text.title")}</h2>
      <p className="muted">{t("text.subtitle")}</p>
      <div className="controlRow">
        <input className="textInput" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t("project.newName")} />
        <button type="button" className="primaryButton ghostButton" onClick={onCreateProject}>
          {t("project.create")}
        </button>
      </div>
      <div className="controlRow">
        <select className="textInput" value={currentProject?.id || ""} onChange={(event) => onSelectProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button type="button" className="primaryButton ghostButton" onClick={onFillDemo}>
          {t("text.fillDemo")}
        </button>
      </div>
      <textarea
        className="textArea"
        value={sourceText}
        onChange={(event) => setSourceText(event.target.value)}
        placeholder={t("text.inputPlaceholder")}
      />
      <div className="controlRow">
        <button type="button" className="primaryButton" onClick={onParse} disabled={isParsing || !sourceText.trim()}>
          {isParsing ? t("text.parsingWithProgress", { progress: parseProgress }) : t("text.startParse")}
        </button>
        <button type="button" className="primaryButton ghostButton" onClick={onCancelParse} disabled={!isParsing}>
          {t("text.stopParse")}
        </button>
        <span className="muted">{currentProject ? `${t("text.writingTo")}${currentProject.name}` : t("text.projectNotSelected")}</span>
      </div>
      {error ? <div className="errorText">{error}</div> : null}
    </GlassCard>
  );
}
