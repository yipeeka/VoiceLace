import { CheckCircle2, ChevronDown, CopyX, Download, FolderOpen, Menu, Pencil, Plus, Save, Settings, Trash2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";

import Button from "../ui/Button";
import DropdownMenu from "../ui/DropdownMenu";
import { useProjectStore } from "../../stores/useProjectStore";
import { useScriptStore } from "../../stores/useScriptStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUiStore } from "../../stores/useUiStore";
import { API_ORIGIN } from "../../utils/api";
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
  const currentSourceTag = currentProject?.id ? getProjectSourceTag(projectSources?.[currentProject.id]) : "未选择";
  const currentProjectDetail = currentProject?.id ? `#${shortProjectId(currentProject.id)}` : "未选择项目";
  const sameNameSiblingProjects = useMemo(
    () => getSameNameSiblingProjects(projects, currentProject),
    [projects, currentProject],
  );

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
    const suggestedName = `项目 ${new Date().toLocaleTimeString("zh-CN")}`;
    const enteredName = window.prompt("新项目名称", suggestedName);
    if (enteredName === null) return;
    const name = enteredName.trim() || suggestedName;
    await createProject(name);
    setSourceText("");
    setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
  }

  async function handleRenameProject(nextProjectName) {
    if (!currentProject?.id) return;
    const nextName = String(nextProjectName || "").trim();
    if (!nextName) {
      useUiStore.getState().pushToast({ title: "项目名称不能为空", tone: "warning" });
      return;
    }
    await renameProject(currentProject.id, nextName);
  }

  async function handlePromptRenameProject() {
    if (!currentProject?.id) return;
    const nextName = window.prompt("项目新名称", currentProject.name || "");
    if (nextName === null) return;
    await handleRenameProject(nextName);
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

  function handleExportProjectArchive() {
    if (!currentProject?.id) {
      useUiStore.getState().pushToast({ title: "请先选择项目", tone: "warning" });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = `${API_ORIGIN}/api/v1/tts/export/${encodeURIComponent(currentProject.id)}/archive`;
    anchor.download = `${projectName || "voicelace-project"}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    useUiStore.getState().pushToast({ title: "开始导出工程 ZIP", tone: "success" });
  }

  const recentProjectItems = useMemo(() => {
    const items = projectOptions.slice(0, 10).map((option) => ({
      label: option.label,
      meta: option.meta,
      title: option.title,
      disabled: option.value === currentProject?.id,
      onSelect: () => hydrateProject(option.value),
    }));
    return items.length ? items : [{ label: "暂无最近项目", disabled: true }];
  }, [currentProject?.id, hydrateProject, projectOptions]);

  const moreMenuItems = useMemo(() => [
    {
      label: "导入工程 ZIP",
      icon: Upload,
      onSelect: () => archiveInputRef.current?.click(),
    },
  ], []);

  return (
    <header className="workspaceHeader">
      <div className="workspaceHeaderTop">
        <div className="workspaceHeaderIdentity">
          <div className="workspaceTitleRow">
            <h1>{projectName}</h1>
            <DropdownMenu
              label="最近项目"
              ariaLabel="切换项目"
              icon={ChevronDown}
              items={recentProjectItems}
              size="sm"
              className="workspaceIconButton workspaceProjectMenuTrigger"
              hideLabel
              showChevron={false}
            />
            <button
              type="button"
              className="workspaceIconButton"
              onClick={handlePromptRenameProject}
              disabled={!currentProject?.id}
              aria-label="改名项目"
              title="改名项目"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspaceIconButton workspaceDangerIconButton"
              onClick={handleDeleteProject}
              disabled={!currentProject?.id}
              aria-label="删除项目"
              title="删除项目"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspaceIconButton workspaceDangerIconButton"
              onClick={handleDeleteSameNameDuplicates}
              disabled={!currentProject?.id || sameNameSiblingProjects.length < 1}
              aria-label="删除同名副本"
              title={sameNameSiblingProjects.length ? `删除同名副本（${sameNameSiblingProjects.length}）` : "没有同名副本"}
            >
              <CopyX size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="workspaceMetaRow">
            <span className="workspaceMetaStatus">
              <CheckCircle2 size={14} aria-hidden="true" />
              {canSaveProject ? "可保存" : "只读状态"}
            </span>
            <span>{pageTitle}</span>
            <span>{currentSourceTag}</span>
            <span>{fileName ? `项目文件：${fileName}` : currentProjectDetail}</span>
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
            icon={Plus}
            onClick={handleCreateProject}
          >
            新项目
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={FolderOpen}
            onClick={handleOpenProjectFileClick}
          >
            打开项目
          </Button>
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
          <Button
            variant="ghost"
            size="sm"
            icon={Download}
            disabled={!currentProject?.id}
            onClick={handleExportProjectArchive}
          >
            导出
          </Button>
          <button
            type="button"
            className="workspaceIconButton"
            onClick={() => onNavigate?.("settings")}
            aria-label="打开系统设置"
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <DropdownMenu
            label="更多操作"
            ariaLabel="更多操作"
            icon={Menu}
            items={moreMenuItems}
            size="sm"
            className="workspaceIconButton"
            hideLabel
            showChevron={false}
          />
        </div>
      </div>
      <input
        ref={archiveInputRef}
        type="file"
        accept=".zip,application/zip"
        className="workspaceHiddenFileInput"
        onChange={handleImportArchive}
      />
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".bvtproject.json,.json,application/json"
        className="workspaceHiddenFileInput"
        onChange={handleProjectFileInput}
      />
    </header>
  );
}
