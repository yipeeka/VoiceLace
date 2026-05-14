import { useEffect, useState } from "react";

import OrchestratorConfigCard from "../components/settings/OrchestratorConfigCard";
import SystemStatusCard from "../components/settings/SystemStatusCard";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useI18n } from "../i18n/I18nProvider";

export default function SettingsPage() {
  const { t, language, setLanguage } = useI18n();
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
    <div className="pageGrid">
      <GlassCard className="fullWidthCard">
        <div className="controlRow" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">{t("settings.language.title")}</h2>
            <p className="cardSubtitle">{t("settings.language.subtitle")}</p>
          </div>
          <div className="controlRow">
            <Button
              variant={language === "zh" ? "primary" : "secondary"}
              onClick={() => setLanguage("zh")}
            >
              {t("settings.language.zh")}
            </Button>
            <Button
              variant={language === "en" ? "primary" : "secondary"}
              onClick={() => setLanguage("en")}
            >
              {t("settings.language.en")}
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
