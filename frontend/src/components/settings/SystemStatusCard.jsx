import { Cpu, RefreshCw, Trash2 } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nProvider";

function SectionTitle({ children }) {
  return (
    <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11, color: "var(--text-muted)", letterSpacing: 0.3 }}>
      {children}
    </div>
  );
}

function compactPath(path) {
  if (!path) return "";
  if (path.length <= 60) return path;
  return `${path.slice(0, 24)}...${path.slice(-28)}`;
}

export default function SystemStatusCard({
  systemStatus,
  settingsError,
  isRefreshing,
  onRefresh,
  onUnloadLLM,
  onUnloadTTS,
  onUnloadMusic,
  onUnloadASR,
}) {
  const { t } = useI18n();
  const gpu = systemStatus?.gpu;
  const llmStatus =
    systemStatus?.llm_status ??
    (systemStatus?.llm_loaded ? "ready" : systemStatus?.llm_error ? "error" : "idle");
  const ttsStatus =
    systemStatus?.tts_status ??
    (systemStatus?.tts_loaded ? "ready" : systemStatus?.tts_error ? "error" : "idle");
  const canUnloadTTS = ttsStatus === "ready" || ttsStatus === "error";
  const musicStatus =
    systemStatus?.music_status ??
    (systemStatus?.music_loaded ? "ready" : systemStatus?.music_error ? "error" : "idle");
  const canUnloadMusic = musicStatus === "ready" || musicStatus === "error";
  const llmBackend = systemStatus?.llm_backend ?? "unknown";
  const llmError = systemStatus?.llm_error ?? "";
  const llmFallbackActive = Boolean(systemStatus?.llm_fallback_active);
  const configuredLlmBackend = systemStatus?.config?.llm_backend ?? "unknown";
  const configuredClipPath = systemStatus?.config?.llm_clip_model_path ?? "";
  const llmLoadMode = systemStatus?.llm_load_mode ?? "";
  const llmThinkModeSupport = systemStatus?.llm_think_mode_support ?? "unknown";
  const llmThinkModeEffective = Boolean(systemStatus?.llm_think_mode_effective);
  const llmHandlerFallbackReason = systemStatus?.llm_handler_fallback_reason ?? "";
  const pythonExecutable = systemStatus?.python_executable ?? "";
  const llamaCppAvailable = Boolean(systemStatus?.llama_cpp_available);
  const llamaCppModulePath = systemStatus?.llama_cpp_module_path ?? "";
  const asrLoaded = Boolean(systemStatus?.asr_loaded);
  const asrBackend = systemStatus?.asr_backend ?? "unknown";
  const asrDefaultBackend = systemStatus?.asr_default_backend ?? systemStatus?.config?.asr_backend ?? "whisper";
  const asrError = systemStatus?.asr_error ?? "";
  const asrDevice = systemStatus?.asr_device ?? "";
  const qwen3Ready = Boolean(systemStatus?.qwen3_asr_ready);
  const qwen3Exe = systemStatus?.qwen3_asr_crispasr_exe ?? "";
  const qwen3Model = systemStatus?.qwen3_asr_model_path ?? "";
  const qwen3AlignerModel = systemStatus?.qwen3_asr_forced_aligner_model_path ?? "";
  const qwen3AlignerModelExists = Boolean(systemStatus?.qwen3_asr_forced_aligner_model_exists);
  const qwen3Timestamps = Boolean(systemStatus?.qwen3_asr_enable_timestamps);
  const pyannoteModelId = systemStatus?.pyannote_model_id ?? "";
  const pyannoteLoaded = Boolean(systemStatus?.pyannote_loaded);
  const pyannoteAvailable = Boolean(systemStatus?.pyannote_available);
  const pyannoteError = systemStatus?.pyannote_error ?? "";
  const canUnloadASR = asrLoaded || Boolean(asrError);

  return (
    <GlassCard>
      <div className="sectionHeader">
        <h2 className="cardTitle">
          <Cpu size={16} /> {t("settings.status.title")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {t("settings.status.refresh")}
        </Button>
      </div>

      <div className="listStack">
        <SectionTitle>{t("settings.status.section.runtime")}</SectionTitle>
        {settingsError ? (
          <div className="statRow">
            <span>{t("settings.status.systemError")}</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {settingsError}
            </strong>
          </div>
        ) : null}
        <div className="statRow">
          <span>{t("settings.status.llmStatus")}</span>
          <strong style={{ color: llmStatus === "ready" ? "var(--success)" : llmStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            {llmStatus}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.llmBackend")}</span>
          <strong style={{ color: llmFallbackActive ? "var(--warning, #f59e0b)" : "var(--text-primary)" }}>
            {llmFallbackActive ? `${llmBackend} (${t("settings.status.fallback")})` : llmBackend}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.llmConfiguredBackend")}</span>
          <strong>{configuredLlmBackend}</strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.thinkModeEffective")}</span>
          <strong style={{ color: llmThinkModeEffective ? "var(--success)" : "var(--text-secondary)" }}>
            {llmThinkModeEffective ? t("common.yes") : t("common.no")}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.thinkModeSupport")}</span>
          <strong>{llmThinkModeSupport}</strong>
        </div>
        {llmLoadMode ? (
          <div className="statRow">
            <span>{t("settings.status.llmLoadMode")}</span>
            <strong title={llmLoadMode} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmLoadMode}
            </strong>
          </div>
        ) : null}
        {configuredClipPath ? (
          <div className="statRow">
            <span>{t("settings.status.llmClipPath")}</span>
            <strong
              title={configuredClipPath}
              style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {compactPath(configuredClipPath)}
            </strong>
          </div>
        ) : null}
        {llmHandlerFallbackReason ? (
          <div className="statRow">
            <span>{t("settings.status.handlerFallbackReason")}</span>
            <strong style={{ color: "var(--warning, #f59e0b)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmHandlerFallbackReason}
            </strong>
          </div>
        ) : null}
        {llmError ? (
          <div className="statRow">
            <span>{t("settings.status.llmError")}</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmError}
            </strong>
          </div>
        ) : null}
        <div className="statRow">
          <span>{t("settings.status.ttsStatus")}</span>
          <strong style={{ color: ttsStatus === "ready" ? "var(--success)" : ttsStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            {ttsStatus}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.musicStatus")}</span>
          <strong style={{ color: musicStatus === "ready" ? "var(--success)" : musicStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            {musicStatus}
          </strong>
        </div>
        {systemStatus?.music_backend ? (
          <div className="statRow">
            <span>{t("settings.status.musicBackend")}</span>
            <strong>{systemStatus.music_backend}</strong>
          </div>
        ) : null}
        <div className="statRow">
          <span>{t("settings.status.musicEnabled")}</span>
          <strong style={{ color: systemStatus?.config?.music_enabled ? "var(--success)" : "var(--text-secondary)" }}>
            {systemStatus?.config?.music_enabled ? t("common.yes") : t("common.no")}
          </strong>
        </div>
        {systemStatus?.music_error ? (
          <div className="statRow">
            <span>{t("settings.status.musicError")}</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {systemStatus.music_error}
            </strong>
          </div>
        ) : null}

        <SectionTitle>{t("settings.status.section.asr")}</SectionTitle>
        <div className="statRow">
          <span>{t("settings.status.asrStatus")}</span>
          <strong style={{ color: asrLoaded ? "var(--success)" : "var(--text-secondary)" }}>
            {asrLoaded ? `${t("settings.status.ready")} (${asrBackend})` : t("settings.status.idle")}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.asrConfiguredBackend")}</span>
          <strong>{asrDefaultBackend}</strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.asrDevice")}</span>
          <strong>{asrDevice || t("settings.status.notSet")}</strong>
        </div>
        {asrDefaultBackend === "qwen3_crispasr" ? (
          <>
            <div className="statRow">
              <span>{t("settings.status.qwen3Ready")}</span>
              <strong style={{ color: qwen3Ready ? "var(--success)" : "var(--warning)" }}>
                {qwen3Ready ? t("common.yes") : t("common.no")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.crispAsrPath")}</span>
              <strong title={qwen3Exe} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {qwen3Exe || t("settings.status.notSet")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.qwen3Model")}</span>
              <strong title={qwen3Model} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {qwen3Model || t("settings.status.notSet")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.forcedAligner")}</span>
              <strong
                title={qwen3AlignerModel}
                style={{ color: qwen3AlignerModel ? (qwen3AlignerModelExists ? "var(--success)" : "var(--warning)") : "var(--text-secondary)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {qwen3AlignerModel || t("settings.status.notSetOptional")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.timestampMode")}</span>
              <strong>{qwen3Timestamps ? t("settings.status.on") : t("settings.status.off")}</strong>
            </div>
          </>
        ) : null}
        <div className="statRow">
          <span>{t("settings.status.pyannoteAvailable")}</span>
          <strong style={{ color: pyannoteAvailable ? "var(--success)" : "var(--warning)" }}>
            {pyannoteAvailable ? t("common.yes") : t("common.no")}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.pyannoteLoaded")}</span>
          <strong style={{ color: pyannoteLoaded ? "var(--success)" : "var(--text-secondary)" }}>
            {pyannoteLoaded ? t("common.yes") : t("common.no")}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.pyannoteModel")}</span>
          <strong title={pyannoteModelId} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pyannoteModelId || t("settings.status.notSet")}
          </strong>
        </div>
        {pyannoteError ? (
          <div className="statRow">
            <span>{t("settings.status.pyannoteError")}</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pyannoteError}
            </strong>
          </div>
        ) : null}
        {asrError ? (
          <div className="statRow">
            <span>{t("settings.status.asrError")}</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {asrError}
            </strong>
          </div>
        ) : null}

        <SectionTitle>{t("settings.status.section.runtimeEnv")}</SectionTitle>
        <div className="statRow">
          <span>{t("settings.status.pythonExecutable")}</span>
          <strong
            title={pythonExecutable || t("settings.status.notAvailable")}
            style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {compactPath(pythonExecutable) || t("settings.status.notAvailable")}
          </strong>
        </div>
        <div className="statRow">
          <span>{t("settings.status.llamaCppAvailable")}</span>
          <strong style={{ color: llamaCppAvailable ? "var(--success)" : "var(--danger)" }}>
            {llamaCppAvailable ? t("common.yes") : t("common.no")}
          </strong>
        </div>
        {llamaCppModulePath ? (
          <div className="statRow">
            <span>{t("settings.status.llamaCppModule")}</span>
            <strong
              title={llamaCppModulePath}
              style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {compactPath(llamaCppModulePath)}
            </strong>
          </div>
        ) : null}

        <SectionTitle>{t("settings.status.section.gpu")}</SectionTitle>
        {gpu ? (
          <>
            <div className="statRow">
              <span>{t("settings.status.gpu")}</span>
              <strong>{gpu.name ?? t("settings.status.unknown")}</strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.processVram", { source: gpu.process_vram_source || "torch" })}</span>
              <strong style={{ fontFamily: "monospace" }}>
                {((Number(gpu.process_used_vram_mb ?? gpu.torch_reserved_mb ?? 0)) / 1024).toFixed(2)} GB
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.systemVramUsed", { source: gpu.system_vram_source || "torch" })}</span>
              <strong style={{ fontFamily: "monospace" }}>
                {((Number(gpu.system_used_vram_mb ?? gpu.used_vram_mb ?? 0)) / 1024).toFixed(1)} GB / {(gpu.total_vram_mb / 1024).toFixed(1)} GB
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.systemVramFree")}</span>
              <strong style={{ fontFamily: "monospace", color: "var(--success)" }}>
                {((Number(gpu.system_free_vram_mb ?? gpu.free_vram_mb ?? 0)) / 1024).toFixed(1)} GB
              </strong>
            </div>
            <div className="statRow">
              <span>{t("settings.status.torchAllocatedReserved")}</span>
              <strong style={{ fontFamily: "monospace" }}>
                {Number(gpu.torch_allocated_mb ?? 0)} / {Number(gpu.torch_reserved_mb ?? 0)} MB
              </strong>
            </div>
          </>
        ) : (
          <div className="statRow">
            <span>{t("settings.status.gpu")}</span>
            <strong style={{ color: "var(--text-muted)" }}>{t("settings.status.gpuNotDetected")}</strong>
          </div>
        )}
      </div>

      <div className="controlRow" style={{ marginTop: 4 }}>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={llmStatus !== "ready"}
          onClick={onUnloadLLM}
        >
          {t("settings.status.unloadLLM")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={!canUnloadTTS}
          onClick={onUnloadTTS}
        >
          {t("settings.status.unloadTTS")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={!canUnloadMusic}
          onClick={onUnloadMusic}
        >
          {t("settings.status.unloadMusic")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={!canUnloadASR}
          onClick={onUnloadASR}
        >
          {t("settings.status.unloadASR")}
        </Button>
      </div>
    </GlassCard>
  );
}
