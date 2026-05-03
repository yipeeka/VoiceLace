import { useEffect, useState } from "react";

import OrchestratorConfigCard from "../components/settings/OrchestratorConfigCard";
import SystemStatusCard from "../components/settings/SystemStatusCard";
import { useSettingsStore } from "../stores/useSettingsStore";

export default function SettingsPage() {
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
    manualUnloadASR,
  } = useSettingsStore();
  const [form, setForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  return (
    <div className="pageGrid twoCols">
      <SystemStatusCard
        systemStatus={systemStatus}
        settingsError={settingsError}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onUnloadLLM={manualUnloadLLM}
        onUnloadTTS={manualUnloadTTS}
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
  );
}
