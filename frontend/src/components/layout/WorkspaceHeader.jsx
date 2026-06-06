import { CheckCircle2, ChevronDown, FolderOpen, Menu, Save, Settings, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ProjectToolbarCard from "../text/ProjectToolbarCard";
import Button from "../ui/Button";
import { useProjectStore } from "../../stores/useProjectStore";
import { useScriptStore } from "../../stores/useScriptStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUiStore } from "../../stores/useUiStore";
import { openProjectFileWithPicker } from "../../utils/projectFile";
import {
  buildProjectOption,
  getProjectSourceTag,
  getSameNameSiblingProjects,
  shortProjectId,
  toProjectFileDisplayName,
} from "../../utils/projectToolbar";

const PAGE_TITLES = {
  speech: "语音识别",
  text: "文本输入",
  qc: "解析质检",
  script: "剧本编辑",
  voice: "声音配置",
  music: "音乐生成",
  synth: "合成导出",
  settings: "系统设置",
};

function getReadyCount(systemStatus) {
  const checks = [
    systemStatus?.llm_status ?? (systemStatus?.llm_loaded ? "ready" : "idle"),
    systemStatus?.asr_loaded ? "ready" : "idle",
    systemStatus?.tts_status ?? (systemStatus?.tts_loaded ? "ready" : "idle"),
    systemStatus?.music_status ?? (systemStatus?.music_loaded ? "ready" : "idle"),
  ];
  return checks.filter((item) => item === "ready").length;
}

export default function WorkspaceHeader({ activePage, onNavigate }) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentProjectFileName = useProjectStore((state) => state.currentProjectFileName);
  const projects = useProjectStore((state) => state.projects);
  const projectSources = useProjectStore((state) => state.projectSources);
  const createProject = useProjectStore((state) => state.createProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const importArchive = useProjectStore((state) => state.importArchive);
  const importProjectFile = useProjectStore((state) => state.importProjectFile);
  const systemStatus = useSettingsStore((state) => state.systemStatus);
  const loadProjectScript = useScriptStore((state) => state.loadProjectScript);
  const setScript = useScriptStore((state) => state.setScript);
  const setSourceText = useScriptStore((state) => state.setSourceText);
  const projectSaveAction = useUiStore((state) => state.projectSaveAction);
  const archiveInputRef = useRef(null);
  const projectFileInputRef = useRef(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameProjectName, setRenameProjectName] = useState("");
  const canSaveProject = typeof projectSaveAction === "function";
  const projectName = currentProject?.name || "Demo Audiobook";
  const pageTitle = PAGE_TITLES[activePage] || "制作流程";
  const fileName = toProjectFileDisplayName(currentProjectFileName || currentProject?.project_file_name);
  const readyCount = getReadyCount(systemStatus);
  const allReady = readyCount >= 3;
  const sortedProjects = useMemo(
    () => [...(projects || [])].sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || "")),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    const firstProjects = sortedProjects.slice(0, 20);
    if (currentProject?.id && !firstProjects.some((item) => item.id === currentProject.id)) {
      const currentSummary = sortedProjects.find((item) => item.id === currentProject.id);
      return currentSummary ? [currentSummary, ...firstProjects.slice(0, 19)] : firstProjects;
    }
    return firstProjects;
  }, [currentProject?.id, sortedProjects]);
  const projectOptions = useMemo(
    () => visibleProjects.map((project) => buildProjectOption(project, projectSources?.[project.id])),
    [projectSources, visibleProjects],
  );
  const currentProjectMeta = useMemo(() => {
    if (!currentProject?.id) {
      return { sourceTag: "未选择", detail: "未选择项目" };
    }
    const detailParts = [];
    const displayFileName = toProjectFileDisplayName(currentProjectFileName || currentProject.project_file_name);
    if (displayFileName) {
      detailParts.push(displayFileName);
    }
    detailParts.push(`#${shortProjectId(currentProject.id)}`);
    return {
      sourceTag: getProjectSourceTag(projectSources?.[currentProject.id]),
      detail: detailParts.join(" · "),
    };
  }, [currentProject, currentProjectFileName, projectSources]);
  const sameNameSiblingProjects = useMemo(
    () => getSameNameSiblingProjects(projects, currentProject),
    [projects, currentProject],
  );

  useEffect(() => {
    setRenameProjectName(currentProject?.name || "");
  }, [currentProject?.id, currentProject?.name]);

  const hydrateProject = useCallback(async (projectId, options = {}) => {
    if (!projectId) return null;
    const project = await selectProject(projectId, options);
    if (!project) return null;
    setScript(project.script);
    const loadedScript = await loadProjectScript(project.id);
    setSourceText(loadedScript.source_text || "");
    return project;
  }, [loadProjectScript, selectProject, setScript, setSourceText]);

  async function handleCreateProject() {
    const name = newProjectName.trim() || `项目 ${new Date().toLocaleTimeString("zh-CN")}`;
    await createProject(name);
    setNewProjectName("");
    setSourceText("");
    setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
  }

  async function handleRenameProject() {
    if (!currentProject?.id) return;
    const nextName = renameProjectName.trim();
    if (!nextName) {
      useUiStore.getState().pushToast({ title: "项目名称不能为空", tone: "warning" });
      return;
    }
    await renameProject(currentProject.id, nextName);
  }

  async function handleImportArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await importArchive(file);
    if (result?.project?.id) {
      await hydrateProject(result.project.id, { suppressToast: true }).catch(() => undefined);
    }
  }

  async function handleProjectFileInput(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await importProjectFile(file, { fileName: file.name });
    if (result?.project?.id) {
      await hydrateProject(result.project.id, { suppressToast: true }).catch(() => undefined);
    }
  }

  async function handleOpenProjectFileClick() {
    try {
      const picked = await openProjectFileWithPicker();
      if (!picked?.file) {
        projectFileInputRef.current?.click();
        return;
      }
      const result = await importProjectFile(picked.file, { handle: picked.handle, fileName: picked.file.name });
      if (result?.project?.id) {
        await hydrateProject(result.project.id, { suppressToast: true }).catch(() => undefined);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      useUiStore.getState().pushToast({ title: `打开项目文件失败：${error?.message || "未知错误"}`, tone: "error" });
    }
  }

  const handleDeleteProject = useCallback(async () => {
    if (!currentProject?.id) return;
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除项目",
      description: `确认删除项目「${currentProject.name}」？该操作不可撤销。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    await deleteProject(currentProject.id, { silent: true });
    const next = useProjectStore.getState().projects?.[0];
    if (next?.id) {
      await hydrateProject(next.id, { suppressToast: true }).catch(() => undefined);
    }
    useUiStore.getState().pushToast({ title: "项目已删除", tone: "success" });
  }, [currentProject, deleteProject, hydrateProject]);

  const handleDeleteSameNameDuplicates = useCallback(async () => {
    if (!sameNameSiblingProjects.length) return;
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除同名副本",
      description: `将删除 ${sameNameSiblingProjects.length} 个同名项目副本。`,
      confirmLabel: "删除副本",
      danger: true,
    });
    if (!confirmed) return;
    for (const project of sameNameSiblingProjects) {
      await deleteProject(project.id, { silent: true });
    }
    useUiStore.getState().pushToast({ title: `已删除 ${sameNameSiblingProjects.length} 个同名副本`, tone: "success" });
  }, [deleteProject, sameNameSiblingProjects]);

  const moreMenuItems = useMemo(() => [
    {
      label: "删除当前项目",
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id,
      onSelect: handleDeleteProject,
    },
    { type: "separator" },
    {
      label: sameNameSiblingProjects.length ? `删除同名副本（${sameNameSiblingProjects.length}）` : "删除同名副本",
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id || sameNameSiblingProjects.length < 1,
      onSelect: handleDeleteSameNameDuplicates,
    },
  ], [currentProject?.id, handleDeleteProject, handleDeleteSameNameDuplicates, sameNameSiblingProjects.length]);

  return (
    <header className="workspaceHeader">
      <div className="workspaceHeaderTop">
        <div className="workspaceHeaderIdentity">
          <div className="workspaceTitleRow">
            <h1>{projectName}</h1>
            <button type="button" className="workspaceIconButton" aria-label="切换项目">
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button type="button" className="workspaceIconButton" aria-label="收藏项目">
              <Star size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="workspaceMetaRow">
            <span className="workspaceMetaStatus">
              <CheckCircle2 size={14} aria-hidden="true" />
              {canSaveProject ? "可保存" : "只读状态"}
            </span>
            <span>{pageTitle}</span>
            <span>{fileName ? `项目文件：${fileName}` : "本地项目"}</span>
          </div>
        </div>

        <div className="workspaceHeaderActions">
          <span className={`workspaceModelReady ${allReady ? "ready" : ""}`}>
            <span className="statusBarDot ready" />
            {allReady ? "本地模型运行正常" : `模型就绪 ${readyCount}/4`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={Save}
            disabled={!canSaveProject}
            onClick={() => projectSaveAction?.()}
          >
            保存
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={FolderOpen}
            disabled={!canSaveProject}
            onClick={() => projectSaveAction?.({ forceSaveAs: true })}
          >
            另存
          </Button>
          <button
            type="button"
            className="workspaceIconButton"
            onClick={() => onNavigate?.("settings")}
            aria-label="打开系统设置"
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <button type="button" className="workspaceIconButton" aria-label="更多操作">
            <Menu size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="workspaceProjectCommands">
        <ProjectToolbarCard
          currentProject={currentProject}
          currentProjectMeta={currentProjectMeta}
          projectOptions={projectOptions}
          projectName={newProjectName}
          renameProjectName={renameProjectName}
          isParsing={false}
          archiveInputRef={archiveInputRef}
          projectFileInputRef={projectFileInputRef}
          onProjectNameChange={setNewProjectName}
          onProjectNameKeyDown={(event) => event.key === "Enter" && handleCreateProject()}
          onRenameProjectNameChange={setRenameProjectName}
          onRenameProjectNameKeyDown={(event) => event.key === "Enter" && handleRenameProject()}
          onSelectProject={hydrateProject}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onOpenProjectFileClick={handleOpenProjectFileClick}
          onProjectFileInputChange={handleProjectFileInput}
          onImportArchive={handleImportArchive}
          moreMenuItems={moreMenuItems}
        />
      </div>
    </header>
  );
}
