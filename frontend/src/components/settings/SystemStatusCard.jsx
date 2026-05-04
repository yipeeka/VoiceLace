import { Cpu, RefreshCw, Trash2 } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";

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
  onUnloadASR,
}) {
  const gpu = systemStatus?.gpu;
  const llmStatus =
    systemStatus?.llm_status ??
    (systemStatus?.llm_loaded ? "ready" : systemStatus?.llm_error ? "error" : "idle");
  const ttsStatus =
    systemStatus?.tts_status ??
    (systemStatus?.tts_loaded ? "ready" : systemStatus?.tts_error ? "error" : "idle");
  const canUnloadTTS = ttsStatus === "ready" || ttsStatus === "error";
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
  const asrError = systemStatus?.asr_error ?? "";
  const asrDevice = systemStatus?.asr_device ?? "";
  const pyannoteModelId = systemStatus?.pyannote_model_id ?? "";
  const pyannoteLoaded = Boolean(systemStatus?.pyannote_loaded);
  const pyannoteAvailable = Boolean(systemStatus?.pyannote_available);
  const pyannoteError = systemStatus?.pyannote_error ?? "";
  const canUnloadASR = asrLoaded || Boolean(asrError);

  return (
    <GlassCard>
      <div className="sectionHeader">
        <h2 className="cardTitle">
          <Cpu size={16} /> 系统状态
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          刷新
        </Button>
      </div>

      <div className="listStack">
        <SectionTitle>模型运行状态</SectionTitle>
        {settingsError ? (
          <div className="statRow">
            <span>系统错误</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {settingsError}
            </strong>
          </div>
        ) : null}
        <div className="statRow">
          <span>LLM 状态</span>
          <strong style={{ color: llmStatus === "ready" ? "var(--success)" : llmStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            {llmStatus}
          </strong>
        </div>
        <div className="statRow">
          <span>LLM 后端</span>
          <strong style={{ color: llmFallbackActive ? "var(--warning, #f59e0b)" : "var(--text-primary)" }}>
            {llmFallbackActive ? `${llmBackend} (fallback)` : llmBackend}
          </strong>
        </div>
        <div className="statRow">
          <span>LLM 配置后端</span>
          <strong>{configuredLlmBackend}</strong>
        </div>
        <div className="statRow">
          <span>Think 模式生效</span>
          <strong style={{ color: llmThinkModeEffective ? "var(--success)" : "var(--text-secondary)" }}>
            {llmThinkModeEffective ? "yes" : "no"}
          </strong>
        </div>
        <div className="statRow">
          <span>Think 支持类型</span>
          <strong>{llmThinkModeSupport}</strong>
        </div>
        {llmLoadMode ? (
          <div className="statRow">
            <span>LLM 加载模式</span>
            <strong title={llmLoadMode} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmLoadMode}
            </strong>
          </div>
        ) : null}
        {configuredClipPath ? (
          <div className="statRow">
            <span>LLM CLIP 路径</span>
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
            <span>Handler 降级原因</span>
            <strong style={{ color: "var(--warning, #f59e0b)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmHandlerFallbackReason}
            </strong>
          </div>
        ) : null}
        {llmError ? (
          <div className="statRow">
            <span>LLM 错误</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {llmError}
            </strong>
          </div>
        ) : null}
        <div className="statRow">
          <span>TTS 状态</span>
          <strong style={{ color: ttsStatus === "ready" ? "var(--success)" : ttsStatus === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            {ttsStatus}
          </strong>
        </div>

        <SectionTitle>ASR 状态</SectionTitle>
        <div className="statRow">
          <span>ASR 状态</span>
          <strong style={{ color: asrLoaded ? "var(--success)" : "var(--text-secondary)" }}>
            {asrLoaded ? `ready (${asrBackend})` : "idle"}
          </strong>
        </div>
        <div className="statRow">
          <span>ASR 设备</span>
          <strong>{asrDevice || "未设置"}</strong>
        </div>
        <div className="statRow">
          <span>pyannote 可用</span>
          <strong style={{ color: pyannoteAvailable ? "var(--success)" : "var(--warning)" }}>
            {pyannoteAvailable ? "yes" : "no"}
          </strong>
        </div>
        <div className="statRow">
          <span>pyannote 已加载</span>
          <strong style={{ color: pyannoteLoaded ? "var(--success)" : "var(--text-secondary)" }}>
            {pyannoteLoaded ? "yes" : "no"}
          </strong>
        </div>
        <div className="statRow">
          <span>pyannote 模型</span>
          <strong title={pyannoteModelId} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pyannoteModelId || "未设置"}
          </strong>
        </div>
        {pyannoteError ? (
          <div className="statRow">
            <span>pyannote 错误</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pyannoteError}
            </strong>
          </div>
        ) : null}
        {asrError ? (
          <div className="statRow">
            <span>ASR 错误</span>
            <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {asrError}
            </strong>
          </div>
        ) : null}

        <SectionTitle>运行环境</SectionTitle>
        <div className="statRow">
          <span>Python 解释器</span>
          <strong
            title={pythonExecutable || "未获取"}
            style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {compactPath(pythonExecutable) || "未获取"}
          </strong>
        </div>
        <div className="statRow">
          <span>llama_cpp 可用</span>
          <strong style={{ color: llamaCppAvailable ? "var(--success)" : "var(--danger)" }}>
            {llamaCppAvailable ? "yes" : "no"}
          </strong>
        </div>
        {llamaCppModulePath ? (
          <div className="statRow">
            <span>llama_cpp 模块</span>
            <strong
              title={llamaCppModulePath}
              style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {compactPath(llamaCppModulePath)}
            </strong>
          </div>
        ) : null}

        <SectionTitle>GPU 资源</SectionTitle>
        {gpu ? (
          <>
            <div className="statRow">
              <span>GPU</span>
              <strong>{gpu.name ?? "Unknown"}</strong>
            </div>
            <div className="statRow">
              <span>VRAM 已用</span>
              <strong style={{ fontFamily: "monospace" }}>
                {(gpu.used_vram_mb / 1024).toFixed(1)} GB / {(gpu.total_vram_mb / 1024).toFixed(1)} GB
              </strong>
            </div>
            <div className="statRow">
              <span>VRAM 空闲</span>
              <strong style={{ fontFamily: "monospace", color: "var(--success)" }}>
                {(gpu.free_vram_mb / 1024).toFixed(1)} GB
              </strong>
            </div>
          </>
        ) : (
          <div className="statRow">
            <span>GPU</span>
            <strong style={{ color: "var(--text-muted)" }}>未检测到</strong>
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
          卸载 LLM
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={!canUnloadTTS}
          onClick={onUnloadTTS}
        >
          卸载 TTS
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={!canUnloadASR}
          onClick={onUnloadASR}
        >
          卸载 ASR
        </Button>
      </div>
    </GlassCard>
  );
}
