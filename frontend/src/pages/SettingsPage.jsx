import { Cpu, HardDrive, RefreshCw, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { useSettingsStore } from "../stores/useSettingsStore";

export default function SettingsPage() {
  const { systemStatus, orchestratorConfig, refreshSystemStatus, loadOrchestratorConfig, saveOrchestratorConfig, resetOrchestratorConfig, manualUnloadLLM, manualUnloadTTS } =
    useSettingsStore();

  const [form, setForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadOrchestratorConfig().then((cfg) => {
      if (cfg) setForm(cfg);
    });
    refreshSystemStatus();
  }, []);

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form) return;
    setIsSaving(true);
    await saveOrchestratorConfig(form);
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
      setForm({
        ...saved,
        tts_model_dir: saved.tts_model_path ?? "",
        auto_serial_mode: Boolean(saved.auto_serial),
        enable_llama_cpp_think_mode: Boolean(saved.enable_llama_cpp_think_mode ?? true),
        llm_n_layer: Number(saved.llm_n_gpu_layers ?? -1),
        llm_threads: Number(saved.llm_threads ?? 0),
        llm_temperature: Number(saved.llm_temperature ?? 0.2),
        llm_top_p: Number(saved.llm_top_p ?? 0.9),
        llm_top_k: Number(saved.llm_top_k ?? 40),
        llm_min_p: Number(saved.llm_min_p ?? 0),
        llm_presence_penalty: Number(saved.llm_presence_penalty ?? 0),
        llm_repeat_penalty: Number(saved.llm_repeat_penalty ?? 1),
        llm_max_tokens: Number(saved.llm_max_tokens ?? 2048),
        llm_backend: saved.llm_backend ?? "llama_cpp",
        llm_api_model: saved.llm_api_model ?? "",
        asr_model_path: saved.asr_model_path ?? "base",
        asr_device: saved.asr_device ?? "cuda:0",
      });
      await refreshSystemStatus();
    }
    setIsSaving(false);
  }

  const gpu = systemStatus?.gpu;
  const llmStatus =
    systemStatus?.llm_status ??
    (systemStatus?.llm_loaded ? "ready" : systemStatus?.llm_error ? "error" : "idle");
  const ttsStatus =
    systemStatus?.tts_status ??
    (systemStatus?.tts_loaded ? "ready" : systemStatus?.tts_error ? "error" : "idle");
  const llmBackend = systemStatus?.llm_backend ?? "unknown";
  const llmError = systemStatus?.llm_error ?? "";
  const llmFallbackActive = Boolean(systemStatus?.llm_fallback_active);
  const asrLoaded = Boolean(systemStatus?.asr_loaded);
  const asrBackend = systemStatus?.asr_backend ?? "unknown";
  const asrError = systemStatus?.asr_error ?? "";
  const asrDevice = systemStatus?.asr_device ?? "";
  const llmBackendOptions = [
    { value: "llama_cpp", label: "llama.cpp (本地 GGUF)" },
    { value: "openai", label: "OpenAI API" },
    { value: "gemini", label: "Gemini API" },
    { value: "mock", label: "Mock (调试)" },
  ];

  return (
    <div className="pageGrid twoCols">
      {/* System status */}
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
            onClick={handleRefresh}
          >
            刷新
          </Button>
        </div>

        <div className="listStack">
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
          {asrError ? (
            <div className="statRow">
              <span>ASR 错误</span>
              <strong style={{ color: "var(--danger)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {asrError}
              </strong>
            </div>
          ) : null}

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
            onClick={manualUnloadLLM}
          >
            卸载 LLM
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            disabled={ttsStatus !== "ready"}
            onClick={manualUnloadTTS}
          >
            卸载 TTS
          </Button>
        </div>
      </GlassCard>

      {/* Orchestrator config */}
      <GlassCard>
        <h2 className="cardTitle">
          <Settings size={16} /> 模型调度配置
        </h2>
        <p className="cardSubtitle">配置 LLM / TTS 模型文件路径与自动串行模式。</p>

        {form ? (
          <>
            <div className="formGroup">
              <label className="formLabel">LLM 后端</label>
              <select
                className="textInput"
                value={form.llm_backend ?? "llama_cpp"}
                onChange={(e) => setField("llm_backend", e.target.value)}
              >
                {llmBackendOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="formGroup">
              <label className="formLabel">LLM 模型路径</label>
              <input
                className="textInput"
                value={form.llm_model_path ?? ""}
                onChange={(e) => setField("llm_model_path", e.target.value)}
                placeholder="e.g. D:/models/qwen2.5-7b-q4.gguf"
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">LLM API 模型名（OpenAI/Gemini）</label>
              <input
                className="textInput"
                value={form.llm_api_model ?? ""}
                onChange={(e) => setField("llm_api_model", e.target.value)}
                placeholder="如 gpt-4.1-mini / gemini-2.5-flash"
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">TTS 模型目录</label>
              <input
                className="textInput"
                value={form.tts_model_dir ?? ""}
                onChange={(e) => setField("tts_model_dir", e.target.value)}
                placeholder="e.g. D:/models/omnivoice"
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">ASR 模型目录/名称</label>
              <input
                className="textInput"
                value={form.asr_model_path ?? "base"}
                onChange={(e) => setField("asr_model_path", e.target.value)}
                placeholder="如 E:/models/faster-whisper-large-v3 或 base"
              />
            </div>

            <div className="editorGrid three">
              <div className="formGroup">
                <label className="formLabel">temperature</label>
                <input className="textInput" type="number" step="0.01" min="0" max="2" value={form.llm_temperature ?? 0.2} onChange={(e) => setField("llm_temperature", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">top_p</label>
                <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_top_p ?? 0.9} onChange={(e) => setField("llm_top_p", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">top_k</label>
                <input className="textInput" type="number" step="1" min="0" value={form.llm_top_k ?? 40} onChange={(e) => setField("llm_top_k", e.target.value)} />
              </div>
            </div>

            <div className="editorGrid three">
              <div className="formGroup">
                <label className="formLabel">min_p</label>
                <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_min_p ?? 0} onChange={(e) => setField("llm_min_p", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">presence_penalty</label>
                <input className="textInput" type="number" step="0.01" min="-2" max="2" value={form.llm_presence_penalty ?? 0} onChange={(e) => setField("llm_presence_penalty", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">repeat_penalty</label>
                <input className="textInput" type="number" step="0.01" min="0" max="3" value={form.llm_repeat_penalty ?? 1} onChange={(e) => setField("llm_repeat_penalty", e.target.value)} />
              </div>
            </div>

            <div className="editorGrid three">
              <div className="formGroup">
                <label className="formLabel">ctx-size (n_ctx)</label>
                <input className="textInput" type="number" step="1" min="256" value={form.llm_n_ctx ?? 8192} onChange={(e) => setField("llm_n_ctx", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">n-layer (GPU)</label>
                <input className="textInput" type="number" step="1" value={form.llm_n_layer ?? -1} onChange={(e) => setField("llm_n_layer", e.target.value)} />
              </div>
              <div className="formGroup">
                <label className="formLabel">thread</label>
                <input className="textInput" type="number" step="1" min="0" value={form.llm_threads ?? 0} onChange={(e) => setField("llm_threads", e.target.value)} />
              </div>
            </div>

            <div className="formGroup">
              <label className="formLabel">max out token</label>
              <input className="textInput" type="number" step="1" min="64" value={form.llm_max_tokens ?? 2048} onChange={(e) => setField("llm_max_tokens", e.target.value)} />
            </div>

            <label
              className="controlRow"
              style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
            >
              <input
                type="checkbox"
                checked={Boolean(form.auto_serial_mode)}
                onChange={(e) => setField("auto_serial_mode", e.target.checked)}
                style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>自动串行模式</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>解析完成后自动卸载 LLM，再加载 TTS</span>
              </div>
            </label>

            <label
              className="controlRow"
              style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
            >
              <input
                type="checkbox"
                checked={Boolean(form.enable_llama_cpp_think_mode ?? true)}
                onChange={(e) => setField("enable_llama_cpp_think_mode", e.target.checked)}
                style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>启用 llama-cpp-python Think 模式</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>开启时向 Qwen/llama.cpp 注入 /think，关闭时注入 /no_think</span>
              </div>
            </label>

            <div className="formGroup">
              <label className="formLabel">LLM 系统提示词（默认）</label>
              <textarea
                className="textArea"
                style={{ minHeight: 120, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                value={form.default_system_prompt ?? ""}
                onChange={(e) => setField("default_system_prompt", e.target.value)}
                placeholder="留空使用内置提示词"
              />
            </div>

            <div className="controlRow">
              <Button variant="primary" disabled={isSaving} onClick={handleSave}>
                {isSaving ? "保存中..." : "保存配置"}
              </Button>
              <Button variant="secondary" disabled={isSaving} onClick={handleReset}>
                Reset 缺省值
              </Button>
            </div>
          </>
        ) : (
          <div className="emptyState">
            <HardDrive size={28} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-muted)" }}>正在加载配置...</span>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
