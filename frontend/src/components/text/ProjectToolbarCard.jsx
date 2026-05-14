import { FolderOpen, Upload } from "lucide-react";

import Button from "../ui/Button";
import DropdownMenu from "../ui/DropdownMenu";
import Select from "../ui/Select";
import { useI18n } from "../../i18n/I18nProvider";

export default function ProjectToolbarCard({
  currentProject,
  currentProjectMeta,
  projectOptions,
  projectName,
  renameProjectName,
  isParsing,
  archiveInputRef,
  projectFileInputRef,
  onProjectNameChange,
  onProjectNameKeyDown,
  onRenameProjectNameChange,
  onRenameProjectNameKeyDown,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onOpenProjectFileClick,
  onProjectFileInputChange,
  onImportArchive,
  moreMenuItems,
}) {
  const { t } = useI18n();

  return (
    <div className="projectToolbar">
      <div className="projectToolbarGroup projectToolbarGroupIdentity">
        <div className="projectToolbarGroupTitle">{t("project.current")}</div>
        <Select
          value={currentProject?.id ?? ""}
          onValueChange={onSelectProject}
          options={projectOptions}
          placeholder={t("project.select")}
          className="projectToolbarSelect"
        />
        <div className="projectToolbarMetaRow">
          <span className="projectToolbarBadge">{currentProjectMeta?.sourceTag || t("project.unselected")}</span>
          <span className="projectToolbarMetaText" title={currentProjectMeta?.detail || t("project.unselectedDetail")}>
            {currentProjectMeta?.detail || t("project.unselectedDetail")}
          </span>
        </div>
      </div>

      <div className="projectToolbarGroup projectToolbarGroupActions">
        <div className="projectToolbarGroupTitle">{t("project.actions")}</div>
        <div className="projectToolbarCreateRow">
          <input
            className="textInput projectToolbarNameInput"
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder={t("project.newName")}
            onKeyDown={onProjectNameKeyDown}
          />
          <Button variant="secondary" onClick={onCreateProject}>
            {t("project.create")}
          </Button>
        </div>
        <div className="projectToolbarRenameRow">
          <input
            className="textInput projectToolbarNameInput"
            value={renameProjectName}
            onChange={(event) => onRenameProjectNameChange(event.target.value)}
            placeholder={t("project.renameName")}
            onKeyDown={onRenameProjectNameKeyDown}
            disabled={!currentProject || isParsing}
          />
          <Button
            variant="secondary"
            onClick={onRenameProject}
            disabled={!currentProject || isParsing}
          >
            {t("project.rename")}
          </Button>
        </div>
        <div className="projectToolbarActionsPrimary">
          <Button variant="secondary" icon={FolderOpen} onClick={onOpenProjectFileClick} disabled={isParsing}>
            {t("project.openFile")}
          </Button>
          <Button variant="secondary" icon={Upload} onClick={() => archiveInputRef.current?.click()} disabled={isParsing}>
            {t("project.importZip")}
          </Button>
        </div>
        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: "none" }}
          onChange={onImportArchive}
        />
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".bvtproject.json,.json,application/json"
          style={{ display: "none" }}
          onChange={onProjectFileInputChange}
        />
      </div>

      <div className="projectToolbarGroup projectToolbarGroupMore">
        <div className="projectToolbarGroupTitle">{t("project.moreActions")}</div>
        <DropdownMenu
          label={t("common.more")}
          items={moreMenuItems}
          className="projectToolbarMoreButton"
          disabled={!moreMenuItems?.length}
        />
      </div>
    </div>
  );
}
