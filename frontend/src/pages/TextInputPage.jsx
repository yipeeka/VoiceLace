import { BookOpen, ChevronDown, ChevronUp, FolderOpen, RefreshCw, Square, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import EmptyState from "../components/shared/EmptyState";
import FileDropZone from "../components/shared/FileDropZone";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { buildProjectFilePayload, openProjectFileWithPicker, saveProjectFile } from "../utils/projectFile";

const DEMO_TEXT = `旁白：暮色渐浓，庭院里只剩下风吹竹叶的细响。
林黛玉：宝哥哥，你今日怎么来得这样晚？
贾宝玉：路上被二姐姐叫住了，这才耽搧了。
旁白：黛玉低头轻笑，却仍带着几分嗔意。`;

function toProjectFileDisplayName(fileName) {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  if (/\.bvtproject\.json$/i.test(raw)) {
    return raw.replace(/\.bvtproject\.json$/i, "");
  }
  return raw.replace(/\.json$/i, "");
}

export default function TextInputPage({ onNavigate }) {
  const [projectName, setProjectName] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const streamRef = useRef(null);
  const archiveInputRef = useRef(null);
  const projectFileInputRef = useRef(null);

  const {
    currentProject,
    currentProjectFileHandle,
    projects,
    projectSources,
    createProject,
    selectProject,
    refreshCurrentProject,
    deleteProject,
    importArchive,
    importProjectFile,
    importWarnings,
    bindCurrentProjectFile,
  } =
    useProjectStore();
  const {
    sourceText,
    setSourceText,
    llmStreamOutput,
    parseText,
    cancelParse,
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

  // Auto-scroll stream output
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [llmStreamOutput]);

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
    const result = await parseText({ text: sourceText.trim(), projectId: project.id, prompt });
    if (!result) return; // canceled
    await refreshCurrentProject(project.id);
    onNavigate?.("script");
  }

  async function handleDeleteProject() {
    if (!currentProject?.id) {
      return;
    }
    const ok = window.confirm(`确认删除项目「${currentProject.name}」？该操作不可撤销。`);
    if (!ok) {
      return;
    }
    const deletedId = currentProject.id;
    await deleteProject(deletedId);
    const nextProjects = useProjectStore.getState().projects || [];
    const next = nextProjects.find((p) => p.id !== deletedId);
    if (next) {
      const project = await selectProject(next.id);
      setScript(project.script);
      const s = await loadProjectScript(project.id);
      setSourceText(s.source_text || "");
      return;
    }
    setScript({ title: "", source_text: "", segments: [], characters: [], metadata: {} });
    setSourceText("");
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

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  const wordCount = sourceText.length;
  const estimatedSegments = sourceText.split(/\n/).filter((l) => l.trim()).length;

  const sortedProjects = [...projects].sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""));
  let visibleProjects = sortedProjects.slice(0, 20);
  if (currentProject?.id && !visibleProjects.some((item) => item.id === currentProject.id)) {
    const currentSummary = sortedProjects.find((item) => item.id === currentProject.id);
    if (currentSummary) {
      visibleProjects = [currentSummary, ...visibleProjects.slice(0, 19)];
    }
  }
  const projectOptions = visibleProjects.map((p) => {
    const source = projectSources?.[p.id];
    const icon = source === "archive_import" ? "📦 " : "";
    const fileSuffix =
      source === "project_file" && p.project_file_name
        ? ` - ${toProjectFileDisplayName(p.project_file_name)}`
        : "";
    return { value: p.id, label: `${icon}${p.name}${fileSuffix}` };
  });

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

        {/* Project bar */}
        <div className="controlRow">
          <div style={{ flex: 1 }}>
            <Select
              value={currentProject?.id ?? ""}
              onValueChange={async (id) => {
                const project = await selectProject(id);
                setScript(project.script);
                const s = await loadProjectScript(project.id);
                setSourceText(s.source_text || "");
              }}
              options={projectOptions}
              placeholder="选择项目..."
            />
          </div>
          <input
            className="textInput"
            style={{ maxWidth: 160 }}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="新项目名称"
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
          />
          <Button variant="secondary" onClick={handleCreateProject}>
            新建
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!currentProject} onClick={handleDeleteProject}>
            删除
          </Button>
          <Button variant="secondary" icon={Upload} onClick={() => archiveInputRef.current?.click()} disabled={isParsing}>
            导入工程 ZIP
          </Button>
          <Button variant="secondary" icon={FolderOpen} onClick={handleOpenProjectFileClick} disabled={isParsing}>
            打开项目文件
          </Button>
          <input
            ref={archiveInputRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: "none" }}
            onChange={handleImportArchive}
          />
          <input
            ref={projectFileInputRef}
            type="file"
            accept=".bvtproject.json,.json,application/json"
            style={{ display: "none" }}
            onChange={handleOpenProjectFile}
          />
        </div>
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
        </div>

        {/* Action row */}
        <div className="controlRow">
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
    </div>
  );
}
