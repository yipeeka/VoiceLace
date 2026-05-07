import { useEffect, useState } from "react";
import { FolderOpen, Save } from "lucide-react";

import OrchestratorConfigCard from "../components/settings/OrchestratorConfigCard";
import SystemStatusCard from "../components/settings/SystemStatusCard";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUiStore } from "../stores/useUiStore";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import { getErrorMessage } from "../utils/errors";

export default function SettingsPage() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentProjectFileHandle = useProjectStore((s) => s.currentProjectFileHandle);
  const bindCurrentProjectFile = useProjectStore((s) => s.bindCurrentProjectFile);
  const script = useScriptStore((s) => s.script);
  const sourceText = useScriptStore((s) => s.sourceText);
  const pushToast = useUiStore((s) => s.pushToast);
  const {
    systemStatus,
    settingsError,
    loadOrchestratorConfig,
    saveOrchestratorConfig,
    resetOrchestratorConfig,
    setCurrentConfigAsDefault,
    refreshSystemStatus,
    manualUnloadLLM,
    manualUnloadTTS,
    manualUnloadMusic,
    manualUnloadASR,
  } = useSettingsStore();
  const [form, setForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProjectSaving, setIsProjectSaving] = useState(false);

  useEffect(() => {
    loadOrchestratorConfig().then((cfg) => {
      if (cfg) {
        setForm(cfg);
      }
    });
    refreshSystemStatus();
  }, []);

  function setField(key, val) {
    setForm((prev) => ({ ...(prev ?? {}), [key]: val }));
  }

  async function handleSave() {
    if (!form) {
      return;
    }
    setIsSaving(true);
    const saved = await saveOrchestratorConfig(form);
    if (saved) {
      setForm(saved);
      await refreshSystemStatus();
    }
    setIsSaving(false);
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    await refreshSystemStatus();
    setIsRefreshing(false);
  }

  async function handleReset() {
    setIsSaving(true);
    const saved = await resetOrchestratorConfig();
    if (saved) {
      setForm(saved);
      await refreshSystemStatus();
    }
    setIsSaving(false);
  }

  async function handleSetAsDefault() {
    if (!form) {
      return;
    }
    setIsSaving(true);
    const saved = await saveOrchestratorConfig(form);
    if (saved) {
      setForm(saved);
      await setCurrentConfigAsDefault();
      await refreshSystemStatus();
    }
    setIsSaving(false);
  }

  async function handleSaveProjectFile(options = {}) {
    if (!currentProject) {
      pushToast({ title: "请先创建或选择项目", tone: "warning" });
      return;
    }
    const forceSaveAs = Boolean(options?.forceSaveAs);
    const effectiveScript =
      script && Array.isArray(script.segments) && script.segments.length
        ? script
        : currentProject.script || {
            title: "",
            source_text: "",
            segments: [],
            characters: [],
            metadata: {},
          };
    const payload = buildProjectFilePayload({
      project: currentProject,
      script: effectiveScript,
      sourceText: sourceText || effectiveScript.source_text || "",
    });

    setIsProjectSaving(true);
    try {
      const result = await saveProjectFile({
        payload,
        preferredName: currentProject.name,
        existingHandle: currentProjectFileHandle || null,
        forceSaveAs,
      });
      if (result?.handle) {
        bindCurrentProjectFile({ handle: result.handle, fileName: result.fileName || "" });
      }
      pushToast({
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        pushToast({ title: `保存项目失败：${getErrorMessage(error)}`, tone: "error" });
      }
    } finally {
      setIsProjectSaving(false);
    }
  }

  return (
    <div className="pageGrid">
      <GlassCard className="fullWidthCard">
        <div className="controlRow" style={{ justifyContent: "space-between" }}>
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">项目保存</h2>
            <p className="cardSubtitle">在系统设置页也可直接保存或另存项目文件。</p>
          </div>
          <div className="controlRow">
            <Button
              variant="secondary"
              icon={Save}
              disabled={!currentProject || isProjectSaving}
              onClick={() => handleSaveProjectFile()}
            >
              {isProjectSaving ? "保存中..." : "保存项目"}
            </Button>
            <Button
              variant="secondary"
              icon={FolderOpen}
              disabled={!currentProject || isProjectSaving}
              onClick={() => handleSaveProjectFile({ forceSaveAs: true })}
            >
              另存项目
            </Button>
          </div>
        </div>
      </GlassCard>

      <div className="pageGrid twoCols">
      <SystemStatusCard
        systemStatus={systemStatus}
        settingsError={settingsError}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onUnloadLLM={manualUnloadLLM}
        onUnloadTTS={manualUnloadTTS}
        onUnloadMusic={manualUnloadMusic}
        onUnloadASR={manualUnloadASR}
      />

      <OrchestratorConfigCard
        form={form}
        isSaving={isSaving}
        onSetField={setField}
        onSave={handleSave}
        onSetAsDefault={handleSetAsDefault}
        onReset={handleReset}
      />
      </div>
    </div>
  );
}
