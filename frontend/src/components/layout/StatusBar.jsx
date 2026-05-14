import { Cpu, MemoryStick } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { getWsBaseUrl } from "../../utils/api";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useUiStore } from "../../stores/useUiStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useScriptStore } from "../../stores/useScriptStore";
import { useI18n } from "../../i18n/I18nProvider";

export default function StatusBar() {
  const { t } = useI18n();
  const { systemStatus, refreshSystemStatus } = useSettingsStore();
  const parseStats = useScriptStore((state) => state.parseStats);
  const wsUrl = `${getWsBaseUrl()}/ws/system/gpu-realtime`;

  useEffect(() => {
    refreshSystemStatus();
  }, [refreshSystemStatus]);

  const { status: wsStatus } = useWebSocket(wsUrl, {
    maxRetries: 6,
    baseDelay: 1000,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "gpu_realtime") {
          return;
        }
        useSettingsStore.setState((state) => ({
          systemStatus: {
            ...(state.systemStatus || {}),
            state: msg.state,
            llm_loaded: msg.llm_loaded,
            tts_loaded: msg.tts_loaded,
            gpu: msg.gpu || {},
          },
        }));
      } catch {
        // ignore malformed ws payload
      }
    },
    onError: () => {
      refreshSystemStatus();
    },
  });

  const llmStatus = systemStatus?.llm_status ?? (systemStatus?.llm_loaded ? "ready" : "idle");
  const ttsStatus = systemStatus?.tts_status ?? (systemStatus?.tts_loaded ? "ready" : "idle");
  const gpu = systemStatus?.gpu;
  const gpuTotal = Number(gpu?.total_vram_mb || 0);
  const systemUsedVram = Number(gpu?.system_used_vram_mb ?? gpu?.used_vram_mb ?? 0);
  const appUsedVram = Number(gpu?.process_used_vram_mb ?? gpu?.torch_reserved_mb ?? gpu?.used_vram_mb ?? 0);
  const processSource = String(gpu?.process_vram_source || "torch");
  const appLabel = processSource === "torch" ? t("status.appTorch") : t("status.app");
  const ratio = useMemo(() => {
    if (gpuTotal <= 0) {
      return 0;
    }
    return systemUsedVram / gpuTotal;
  }, [gpuTotal, systemUsedVram]);
  const lastWarnLevel = useRef(0);

  useEffect(() => {
    const pushToast = useUiStore.getState().pushToast;
    if (ratio >= 0.93 && lastWarnLevel.current < 2) {
      pushToast({ title: t("status.toast.vramTooHigh"), tone: "error" });
      lastWarnLevel.current = 2;
      return;
    }
    if (ratio >= 0.85 && lastWarnLevel.current < 1) {
      pushToast({ title: t("status.toast.vramHigh"), tone: "default" });
      lastWarnLevel.current = 1;
      return;
    }
    if (ratio < 0.85) {
      lastWarnLevel.current = 0;
    }
  }, [ratio]);

  const llmDot =
    llmStatus === "ready" ? "ready" :
    llmStatus === "idle"  ? "idle"  :
    llmStatus === "error" ? "error" : "loading";

  const ttsDot =
    ttsStatus === "ready" ? "ready" :
    ttsStatus === "idle"  ? "idle"  :
    ttsStatus === "error" ? "error" : "loading";

  const LLM_LABELS = {
    idle: t("status.state.idle"),
    ready: t("status.state.ready"),
    loading: t("status.state.loading"),
    unloading: t("status.state.unloading"),
    error: t("status.state.error"),
  };
  const TTS_LABELS = { ...LLM_LABELS };
  const parseSummary = useMemo(() => {
    if (!parseStats || typeof parseStats !== "object") {
      return "";
    }
    const parseModeLabel =
      parseStats.parse_mode === "verified_five_step_pipeline"
        ? t("script.parseMode.verifiedFiveStep")
        : parseStats.parse_mode === "two_step_pipeline"
          ? t("script.parseMode.twoStep")
          : parseStats.parse_mode === "legacy_single_pass"
            ? t("script.parseMode.singleStep")
            : parseStats.parse_mode === "read_aloud_single_voice"
              ? t("script.parseMode.readAloud")
              : t("common.unknown");
    const modeLabel =
      parseStats.mode === "two_step"
        ? t("script.mode.twoStepFlow")
        : parseStats.mode === "chunked"
          ? t("script.mode.chunked")
          : parseStats.mode === "single"
            ? t("script.mode.singleSegment")
            : (parseStats.mode || "unknown");
    const chunks = Number(parseStats.total_chunks ?? 0) || 0;
    const durationMs = Number(parseStats.duration_ms ?? 0) || 0;
    const repairCount = Number(parseStats.repair_used_count ?? 0) || 0;
    const fallbackCount = Number(parseStats.fallback_count ?? 0) || 0;
    const sec = durationMs > 0 ? (durationMs / 1000).toFixed(1) : "?";
    return t("status.parseSummary", {
      parseModeLabel,
      modeLabel,
      chunks: chunks || "?",
      sec,
      repairCount,
      fallbackCount,
    });
  }, [parseStats, t]);

  return (
    <div className="statusBar">
      <div className="statusBarItem">
        <Cpu size={12} style={{ color: "var(--text-muted)" }} />
        <span>{t("status.llm")}</span>
        <span className={`statusBarDot ${llmDot}`} />
        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
          {LLM_LABELS[llmStatus] ?? llmStatus}
        </span>
      </div>

      <div className="statusBarItem">
        <span>{t("status.tts")}</span>
        <span className={`statusBarDot ${ttsDot}`} />
        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
          {TTS_LABELS[ttsStatus] ?? ttsStatus}
        </span>
      </div>

      {gpu && (
        <div
          className="statusBarItem"
          title={t("status.vramTooltip", {
            app: ((appUsedVram || 0) / 1024).toFixed(2),
            processSource,
            system: ((systemUsedVram || 0) / 1024).toFixed(2),
            total: ((gpuTotal || 0) / 1024).toFixed(1),
            systemSource: gpu?.system_vram_source || "torch",
          })}
        >
          <MemoryStick size={12} style={{ color: "var(--text-muted)" }} />
          <span>{t("status.vram")}</span>
          <span
            style={{
              color: ratio >= 0.93 ? "var(--danger)" : ratio >= 0.85 ? "var(--warning)" : "var(--text-primary)",
              fontWeight: 500,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {appLabel} {(appUsedVram / 1024).toFixed(1)} GB · {t("status.gpu")} {(systemUsedVram / 1024).toFixed(1)}&thinsp;/&thinsp;{(gpuTotal / 1024).toFixed(1)} GB
          </span>
        </div>
      )}

      {parseSummary && (
        <div className="statusBarItem statusBarParseItem" title={parseSummary}>
          <span>{t("status.recentParse")}</span>
          <span className="statusBarParseText" style={{ color: "var(--text-primary)", fontWeight: 500 }}>
            {parseSummary}
          </span>
        </div>
      )}

      <div className="statusBarItem" style={{ marginLeft: "auto", border: "none" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          {wsStatus === "open" ? t("status.ws.connected") : wsStatus === "reconnecting" ? t("status.ws.reconnecting") : t("status.ws.disconnected")} · VoiceLace v0.1
        </span>
      </div>
    </div>
  );
}
