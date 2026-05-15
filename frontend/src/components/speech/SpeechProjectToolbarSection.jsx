import GlassCard from "../shared/GlassCard";
import ProjectToolbarCard from "../text/ProjectToolbarCard";

export default function SpeechProjectToolbarSection({
  archiveInputRef,
  currentProject,
  currentProjectMeta,
  importWarnings,
  isProjectOpsBusy,
  moreMenuItems,
  newProjectName,
  onCreateProject,
  onImportArchive,
  onOpenProjectFile,
  onOpenProjectFileClick,
  onProjectNameChange,
  onProjectNameKeyDown,
  onRenameProject,
  onRenameProjectNameChange,
  onRenameProjectNameKeyDown,
  onSelectProject,
  projectFileInputRef,
  projectOptions,
  renameProjectName,
}) {
  return (
    <GlassCard>
      <ProjectToolbarCard
        currentProject={currentProject}
        currentProjectMeta={currentProjectMeta}
        projectOptions={projectOptions}
        projectName={newProjectName}
        renameProjectName={renameProjectName}
        isParsing={isProjectOpsBusy}
        archiveInputRef={archiveInputRef}
        projectFileInputRef={projectFileInputRef}
        onProjectNameChange={onProjectNameChange}
        onProjectNameKeyDown={onProjectNameKeyDown}
        onRenameProjectNameChange={onRenameProjectNameChange}
        onRenameProjectNameKeyDown={onRenameProjectNameKeyDown}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onRenameProject={onRenameProject}
        onOpenProjectFileClick={onOpenProjectFileClick}
        onProjectFileInputChange={onOpenProjectFile}
        onImportArchive={onImportArchive}
        moreMenuItems={moreMenuItems}
      />
      {importWarnings?.length ? (
        <div className="statusBadge warning projectImportWarnings">
          {importWarnings.map((warning, idx) => (
            <div key={`${idx}-${warning}`}>导入提示 {idx + 1}: {warning}</div>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}
