import { BookOpen, ChevronDown, ChevronUp, RefreshCw, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmptyState from "../components/shared/EmptyState";
import FileDropZone from "../components/shared/FileDropZone";
import GlassCard from "../components/shared/GlassCard";
import ProjectHistoryCard from "../components/text/ProjectHistoryCard";
import ProjectToolbarCard from "../components/text/ProjectToolbarCard";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { api } from "../utils/api";
import { buildProjectFilePayload, openProjectFileWithPicker, saveProjectFile } from "../utils/projectFile";
import {
  buildProjectOption,
  getProjectSourceTag,
  getSameNameSiblingProjects,
  shortProjectId,
  toProjectFileDisplayName,
} from "../utils/projectToolbar";

const DEMO_TEXT = `旁白：暮色渐浓，庭院里只剩下风吹竹叶的细响。
林黛玉：宝哥哥，你今日怎么来得这样晚？
贾宝玉：路上被二姐姐叫住了，这才耽搧了。
旁白：黛玉低头轻笑，却仍带着几分嗔意。`;

const PARSE_MODE_OPTIONS = [
  { value: "verified_five_step_pipeline", label: "快速解析（推荐）" },
  { value: "two_step_pipeline", label: "两步解析" },
  { value: "legacy_single_pass", label: "单步解析" },
  { value: "read_aloud_single_voice", label: "单人朗读" },
];

export default function TextInputPage({ onNavigate }) {
  const [projectName, setProjectName] = useState("");
  const [renameProjectName, setRenameProjectName] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const streamRef = useRef(null);
  const archiveInputRef = useRef(null);
  const projectFileInputRef = useRef(null);

  const {
    currentProject,
    currentProjectFileHandle,
    currentProjectFileName,
    projects,
    projectSources,
    createProject,
    renameProject,
    selectProject,
    refreshCurrentProject,
    loadProjects,
    deleteProject,
    importArchive,
    importProjectFile,
    importWarnings,
    bindCurrentProjectFile,
    projectHistory,
    loadProjectHistory,
    restoreProjectSnapshot,
  } =
    useProjectStore();
  const {
    sourceText,
    setSourceText,
    llmStreamOutput,
    parseText,
    cancelParse,
    parseMode,
    setParseMode,
    parseStage,
    parseStageLabel,
    parseStageProgress,
    isParsing,
    status,
    connectionStatus,
    modelStatus,
    lastSyncError,
    parseProgress,
    error,
    script,
    setScript,
    loadProjectScript,
  } = useScriptStore();
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Auto-scroll stream output
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [llmStreamOutput]);

  useEffect(() => {
    setRenameProjectName(currentProject?.name || "");
  }, [currentProject?.id, currentProject?.name]);

  useEffect(() => {
    let canceled = false;
    async function loadHistoryRows() {
      if (!currentProject?.id) {
        return;
      }
      setIsHistoryLoading(true);
      try {
        await loadProjectHistory(currentProject.id, 120);
      } finally {
        if (!canceled) {
          setIsHistoryLoading(false);
        }
      }
    }
    loadHistoryRows().catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [currentProject?.id, loadProjectHistory]);

  const selectProjectAndHydrate = useCallback(async (projectId, options = {}) => {
    if (!projectId) {
      return null;
    }
    const project = await selectProject(projectId, options);
    if (!project) {
      return null;
    }
    setScript(project.script);
    const loadedScript = await loadProjectScript(project.id);
    setSourceText(loadedScript.source_text || "");
    return project;
  }, [loadProjectScript, selectProject, setScript, setSourceText]);

  async function handleCreateProject() {
    const name = projectName.trim() || `项目 ${new Date().toLocaleTimeString("zh-CN")}`;
    await createProject(name);
    setProjectName("");
    setSourceText("");
    setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
  }

  async function handleParse() {
    let project = currentProject;
    if (!project) {
      project = await createProject(projectName.trim() || "默认项目");
      setProjectName("");
    }
    const result = await parseText({ text: sourceText.trim(), projectId: project.id, prompt, parseMode });
    if (!result) return; // canceled
    await refreshCurrentProject(project.id);
    onNavigate?.("script");
  }

  async function handleRenameProject() {
    if (!currentProject?.id) {
      return;
    }
    const nextName = renameProjectName.trim();
    if (!nextName) {
      useUiStore.getState().pushToast({
        title: "项目名称不能为空",
        tone: "warning",
      });
      return;
    }
    if (nextName === currentProject.name) {
      useUiStore.getState().pushToast({
        title: "项目名称未变化",
        tone: "default",
      });
      return;
    }
    try {
      const updated = await renameProject(currentProject.id, nextName);
      setRenameProjectName(updated.name || nextName);
    } catch (error) {
      useUiStore.getState().pushToast({
        title: `项目改名失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  async function handleDeleteProject() {
    if (!currentProject?.id) {
      return;
    }
    const ok = window.confirm(`确认删除项目「${currentProject.name}」？该操作不可撤销。`);
    if (!ok) {
      return;
    }
    try {
      await deleteProject(currentProject.id, { silent: true });
      useUiStore.getState().pushToast({
        title: "项目已删除",
        tone: "success",
      });
    } catch {
      useUiStore.getState().pushToast({
        title: "项目删除失败，请重试",
        tone: "warning",
      });
      return;
    }

    const nextProjects = useProjectStore.getState().projects || [];
    const next = nextProjects[0];
    if (next) {
      await selectProjectAndHydrate(next.id);
      return;
    }
    setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
    setSourceText("");
  }

  async function handleDeleteSameNameDuplicates() {
    if (!currentProject?.id) {
      return;
    }
    const siblingProjects = getSameNameSiblingProjects(projects, currentProject);
    if (!siblingProjects.length) {
      return;
    }
    const ok = window.confirm(
      `检测到 ${siblingProjects.length} 个与「${currentProject.name}」同名的副本。\n确认删除这些同名副本并保留当前项目？`
    );
    if (!ok) {
      return;
    }

    let deletedCount = 0;
    const failedIds = [];
    for (const project of siblingProjects) {
      try {
        await deleteProject(project.id, { silent: true });
        deletedCount += 1;
      } catch {
        failedIds.push(project.id);
      }
    }

    if (deletedCount > 0) {
      useUiStore.getState().pushToast({
        title: `已删除 ${deletedCount} 个同名副本`,
        tone: "success",
      });
    }
    if (failedIds.length) {
      useUiStore.getState().pushToast({
        title: `有 ${failedIds.length} 个同名副本删除失败，请重试`,
        tone: "warning",
      });
    }
  }

  async function handleCleanupDuplicateProjects() {
    const ok = window.confirm(
      "执行“清理重复项目”将合并 project-file 阴影副本并去重重复 project-file 项目。是否继续？"
    );
    if (!ok) {
      return;
    }

    try {
      const mergeResult = await api.post("/projects/maintenance/merge-project-file-shadows", {
        dry_run: false,
        delete_orphan_event_logs: true,
      });
      const dedupeResult = await api.post("/projects/maintenance/deduplicate-project-files", {
        dry_run: false,
        delete_orphan_event_logs: true,
      });

      const loaded = await loadProjects();
      const stillExists = loaded.some((item) => item.id === currentProject?.id);
      if (!stillExists) {
        if (loaded.length) {
          await selectProjectAndHydrate(loaded[0].id, { suppressToast: true });
        } else {
          setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
          setSourceText("");
        }
      }

      useUiStore.getState().pushToast({
        title: `清理完成：合并 ${mergeResult.remove_count || 0} 个阴影副本，去重 ${dedupeResult.remove_count || 0} 个重复项目`,
        tone: "success",
      });
    } catch (error) {
      useUiStore.getState().pushToast({
        title: `清理重复项目失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => setSourceText(e.target.result || "");
    reader.readAsText(file, "utf-8");
  }

  async function handleImportArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await importArchive(file);
    const project = result?.project;
    if (!project?.id) {
      return;
    }
    setScript(project.script);
    const s = await loadProjectScript(project.id);
    setSourceText(s.source_text || "");
  }

  async function importProjectFileAndSelect(file, options = {}) {
    if (!file) return;
    const result = await importProjectFile(file, options);
    const project = result?.project;
    if (!project?.id) {
      return;
    }
    setScript(project.script);
    const s = await loadProjectScript(project.id);
    setSourceText(s.source_text || "");
  }

  async function handleOpenProjectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await importProjectFileAndSelect(file, { fileName: file?.name || "" });
  }

  async function handleOpenProjectFileClick() {
    try {
      const picked = await openProjectFileWithPicker();
      if (!picked?.file) {
        projectFileInputRef.current?.click();
        return;
      }
      await importProjectFileAndSelect(picked.file, { handle: picked.handle, fileName: picked.file.name });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({
        title: `打开项目文件失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    const forceSaveAs = Boolean(options?.forceSaveAs);
    const fallbackName = projectName.trim() || "未命名项目";
    const fallbackProject = currentProject || {
      name: fallbackName,
      status: sourceText.trim() ? "draft" : "draft",
      voice_assignments: {},
      synthesis_config: undefined,
    };
    const payload = buildProjectFilePayload({
      project: fallbackProject,
      script: script || {
        title: "",
        source_text: "",
        segments: [],
        characters: [],
        metadata: {},
      },
      sourceText,
    });
    try {
      const result = await saveProjectFile({
        payload,
        preferredName: fallbackProject.name,
        existingHandle: currentProjectFileHandle || null,
        forceSaveAs,
      });
      if (result?.handle) {
        bindCurrentProjectFile({ handle: result.handle, fileName: result.fileName || "" });
      }
      useUiStore.getState().pushToast({
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({
        title: `保存项目失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }, [projectName, currentProject, script, sourceText, currentProjectFileHandle, bindCurrentProjectFile]);

  async function handleRefreshHistory() {
    if (!currentProject?.id) return;
    setIsHistoryLoading(true);
    try {
      await loadProjectHistory(currentProject.id, 120);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function handleRollbackSnapshot(snapshotId) {
    if (!currentProject?.id || !snapshotId) return;
    const ok = window.confirm("回滚会覆盖当前项目内容，是否继续？");
    if (!ok) return;
    try {
      await restoreProjectSnapshot(currentProject.id, snapshotId);
      const refreshed = await refreshCurrentProject(currentProject.id);
      setScript(refreshed.script);
      setSourceText(refreshed.script?.source_text || "");
      await loadProjectHistory(currentProject.id, 120);
    } catch (error) {
      useUiStore.getState().pushToast({
        title: `回滚失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  const wordCount = sourceText.length;
  const estimatedSegments = sourceText.split(/\n/).filter((l) => l.trim()).length;
  const fixedPromptMode = parseMode === "verified_five_step_pipeline";

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || "")),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    let nextVisible = sortedProjects.slice(0, 20);
    if (currentProject?.id && !nextVisible.some((item) => item.id === currentProject.id)) {
      const currentSummary = sortedProjects.find((item) => item.id === currentProject.id);
      if (currentSummary) {
        nextVisible = [currentSummary, ...nextVisible.slice(0, 19)];
      }
    }
    return nextVisible;
  }, [currentProject?.id, sortedProjects]);
  const projectOptions = useMemo(
    () => visibleProjects.map((project) => buildProjectOption(project, projectSources?.[project.id])),
    [projectSources, visibleProjects],
  );
  const sameNameSiblingProjects = useMemo(
    () => getSameNameSiblingProjects(projects, currentProject),
    [projects, currentProject],
  );
  const currentProjectMeta = useMemo(() => {
    if (!currentProject?.id) {
      return { sourceTag: "未选择", detail: "未选择项目" };
    }
    const sourceTag = getProjectSourceTag(projectSources?.[currentProject.id]);
    const detailParts = [];
    const fileName = toProjectFileDisplayName(currentProjectFileName || currentProject.project_file_name);
    if (fileName) {
      detailParts.push(fileName);
    }
    detailParts.push(`#${shortProjectId(currentProject.id)}`);
    return {
      sourceTag,
      detail: detailParts.join(" · "),
    };
  }, [currentProject, currentProjectFileName, projectSources]);
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
      label: sameNameSiblingProjects.length
        ? `删除同名副本（${sameNameSiblingProjects.length}）`
        : "删除同名副本",
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id || sameNameSiblingProjects.length < 1,
      title: sameNameSiblingProjects.length
        ? `删除 ${sameNameSiblingProjects.length} 个与当前项目同名的副本`
        : "当前没有可删除的同名副本",
      onSelect: handleDeleteSameNameDuplicates,
    },
    {
      label: "清理重复项目",
      disabled: isParsing,
      onSelect: handleCleanupDuplicateProjects,
    },
  ], [
    currentProject?.id,
    handleCleanupDuplicateProjects,
    handleDeleteProject,
    handleDeleteSameNameDuplicates,
    isParsing,
    sameNameSiblingProjects.length,
  ]);

  return (
    <div className="pageGrid twoCols">
      {/* Left: Input */}
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">
              <BookOpen size={16} />
              文本输入
            </h2>
            <p className="cardSubtitle">粘贴小说、剧本文件，LLM 将自动解析角色与剧本结构。</p>
          </div>
        </div>

        <ProjectToolbarCard
          currentProject={currentProject}
          currentProjectMeta={currentProjectMeta}
          projectOptions={projectOptions}
          projectName={projectName}
          renameProjectName={renameProjectName}
          isParsing={isParsing}
          archiveInputRef={archiveInputRef}
          projectFileInputRef={projectFileInputRef}
          onProjectNameChange={setProjectName}
          onProjectNameKeyDown={(event) => event.key === "Enter" && handleCreateProject()}
          onRenameProjectNameChange={setRenameProjectName}
          onRenameProjectNameKeyDown={(event) => event.key === "Enter" && handleRenameProject()}
          onSelectProject={(projectId) => selectProjectAndHydrate(projectId)}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onOpenProjectFileClick={handleOpenProjectFileClick}
          onProjectFileInputChange={handleOpenProjectFile}
          onImportArchive={handleImportArchive}
          moreMenuItems={moreMenuItems}
        />
        {importWarnings?.length ? (
          <div className="statusBadge warning" style={{ marginBottom: 10, display: "block", textAlign: "left" }}>
            {importWarnings.map((warning, idx) => (
              <div key={`${idx}-${warning}`}>导入提示 {idx + 1}: {warning}</div>
            ))}
          </div>
        ) : null}

        {/* File drop zone */}
        {!sourceText && (
          <FileDropZone
            accept=".txt,.md,.srt"
            onFile={handleFile}
            label="拖拽 .txt / .md / .srt 文件到此处"
            sublabel="或直接在下方编辑区粘贴内容"
          />
        )}

        {/* Text editor */}
        <div style={{ position: "relative" }}>
          <textarea
            className="textArea"
            style={{ minHeight: 200 }}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder={"在这里粘贴文本内容...\n\n示例：\n旁白：暮色渐浓。\n林黛玉：宝哥哥，你今日怎么来得这样晚？"}
          />
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 12,
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "monospace",
            }}
          >
            {wordCount} 字 · 约 {estimatedSegments} 段
          </div>
        </div>

        {/* Prompt collapsible */}
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ gap: 4 }}
            onClick={() => setPromptOpen((o) => !o)}
          >
            {promptOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            自定义提示词（可选）
          </button>
          {promptOpen && (
            <textarea
              className="textArea compactArea"
              style={{ marginTop: 8 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="留空使用默认系统提示词..."
            />
          )}
          {fixedPromptMode ? (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              该模式使用固定提示词模板，会忽略自定义提示词。
            </div>
          ) : null}
        </div>

        {/* Action row */}
        <div className="controlRow">
          <div style={{ minWidth: 210 }}>
            <Select
              value={parseMode}
              onValueChange={(value) => setParseMode(value)}
              options={PARSE_MODE_OPTIONS}
              placeholder="选择解析模式"
              disabled={isParsing}
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            disabled={isParsing || !sourceText.trim()}
            onClick={handleParse}
          >
            {isParsing ? (
              <>
                <RefreshCw size={15} style={{ animation: "spin 0.8s linear infinite" }} />
                解析中 {parseProgress > 0 ? `${parseProgress}%` : ""}
              </>
            ) : (
              "▶ 开始解析"
            )}
          </Button>
          {isParsing && (
            <Button
              variant="danger"
              size="lg"
              onClick={cancelParse}
              icon={Square}
            >
              中断解析
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setSourceText(DEMO_TEXT)}
            disabled={isParsing}
          >
            填充示例
          </Button>
          {sourceText && (
            <Button
              variant="ghost"
              onClick={() => setSourceText("")}
              disabled={isParsing}
            >
              清空
            </Button>
          )}
          {currentProject && (
            <span className="muted" style={{ marginLeft: "auto" }}>
              写入：{currentProject.name}
            </span>
          )}
        </div>

        {error && <div className="errorText">⚠ {error}</div>}
        {!error && isParsing && (parseStageLabel || parseStage) ? (
          <div className="errorText" style={{ color: "var(--text-secondary)" }}>
            当前阶段：{parseStageLabel || parseStage}
            {Number.isFinite(Number(parseStageProgress)) && Number(parseStageProgress) > 0
              ? ` · ${Number(parseStageProgress)}%`
              : ""}
          </div>
        ) : null}
        {!error && (modelStatus || lastSyncError) ? (
          <div className="errorText" style={{ color: lastSyncError ? "var(--danger)" : "var(--text-secondary)" }}>
            {lastSyncError ? `⚠ ${lastSyncError}` : `${modelStatus} · 连接：${connectionStatus} · 任务：${status}`}
          </div>
        ) : null}
      </GlassCard>

      {/* Right: Stream output */}
      <GlassCard>
        <h2 className="cardTitle">解析预览</h2>
        <p className="cardSubtitle">LLM 实时输出，展示模型加卸载状态与剧本生成过程。</p>

        {llmStreamOutput ? (
          <div ref={streamRef} className="streamOutput">
            {llmStreamOutput.split("\n").map((line, i) => {
              const isSys = line.startsWith("[系统]") || line.startsWith("[System]");
              return (
                <div key={i} className={isSys ? "sys-msg" : ""}>
                  {line}
                </div>
              );
            })}
            {isParsing && <span className="streamCursor" />}
          </div>
        ) : (
          <EmptyState
            title="等待解析..."
            description="点击「开始解析」后，LLM 输出会在此实时显示"
          />
        )}
      </GlassCard>

      <ProjectHistoryCard
        projectName={currentProject?.name || ""}
        historyItems={projectHistory}
        isLoading={isHistoryLoading}
        onRefresh={handleRefreshHistory}
        onRollback={handleRollbackSnapshot}
      />
    </div>
  );
}
