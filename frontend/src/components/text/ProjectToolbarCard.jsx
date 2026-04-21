import { FolderOpen, MoreHorizontal, Upload } from "lucide-react";

import Button from "../ui/Button";
import DropdownMenu from "../ui/DropdownMenu";
import Select from "../ui/Select";

export default function ProjectToolbarCard({
  currentProject,
  currentProjectMeta,
  projectOptions,
  projectName,
  isParsing,
  archiveInputRef,
  projectFileInputRef,
  onProjectNameChange,
  onProjectNameKeyDown,
  onSelectProject,
  onCreateProject,
  onOpenProjectFileClick,
  onProjectFileInputChange,
  onImportArchive,
  moreMenuItems,
}) {
  return (
    <div className="projectToolbar">
      <div className="projectToolbarGroup projectToolbarGroupIdentity">
        <div className="projectToolbarGroupTitle">当前项目</div>
        <Select
          value={currentProject?.id ?? ""}
          onValueChange={onSelectProject}
          options={projectOptions}
          placeholder="选择项目..."
          className="projectToolbarSelect"
        />
        <div className="projectToolbarMetaRow">
          <span className="projectToolbarBadge">{currentProjectMeta?.sourceTag || "未选择"}</span>
          <span className="projectToolbarMetaText" title={currentProjectMeta?.detail || "未选择项目"}>
            {currentProjectMeta?.detail || "未选择项目"}
          </span>
        </div>
      </div>

      <div className="projectToolbarGroup projectToolbarGroupActions">
        <div className="projectToolbarGroupTitle">项目操作</div>
        <div className="projectToolbarCreateRow">
          <input
            className="textInput projectToolbarNameInput"
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="新项目名称"
            onKeyDown={onProjectNameKeyDown}
          />
          <Button variant="secondary" onClick={onCreateProject}>
            新建
          </Button>
        </div>
        <div className="projectToolbarActionsPrimary">
          <Button variant="secondary" icon={FolderOpen} onClick={onOpenProjectFileClick} disabled={isParsing}>
            打开项目文件
          </Button>
          <Button variant="secondary" icon={Upload} onClick={() => archiveInputRef.current?.click()} disabled={isParsing}>
            导入工程 ZIP
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
        <div className="projectToolbarGroupTitle">更多操作</div>
        <DropdownMenu
          label="更多"
          icon={MoreHorizontal}
          items={moreMenuItems}
          className="projectToolbarMoreButton"
          disabled={!moreMenuItems?.length}
        />
      </div>
    </div>
  );
}
