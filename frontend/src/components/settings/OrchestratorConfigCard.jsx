import { HardDrive, Settings } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nProvider";

export default function OrchestratorConfigCard({ form, isSaving, onSetField, onSave, onSetAsDefault, onReset }) {
  const { t } = useI18n();
  const llmBackendOptions = [
    { value: "llama_cpp", label: t("settings.orchestrator.option.llmBackend.llamaCpp") },
    { value: "openai", label: t("settings.orchestrator.option.llmBackend.openai") },
    { value: "gemini", label: t("settings.orchestrator.option.llmBackend.gemini") },
    { value: "mock", label: t("settings.orchestrator.option.llmBackend.mock") },
  ];

  return (
    <GlassCard>
      <h2 className="cardTitle">
        <Settings size={16} /> {t("settings.orchestrator.title")}
      </h2>
      <p className="cardSubtitle">{t("settings.orchestrator.subtitle")}</p>

      {form ? (
        <>
          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.llmBackend")}</label>
            <select
              className="textInput"
              value={form.llm_backend ?? "llama_cpp"}
              onChange={(e) => onSetField("llm_backend", e.target.value)}
            >
              {llmBackendOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.llmModelPath")}</label>
            <input
              className="textInput"
              value={form.llm_model_path ?? ""}
              onChange={(e) => onSetField("llm_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.llmModelPath")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.llmClipModelPath")}</label>
            <input
              className="textInput"
              value={form.llm_clip_model_path ?? ""}
              onChange={(e) => onSetField("llm_clip_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.llmClipModelPath")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.llmApiModel")}</label>
            <input
              className="textInput"
              value={form.llm_api_model ?? ""}
              onChange={(e) => onSetField("llm_api_model", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.llmApiModel")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.omniTtsModelDir")}</label>
            <input
              className="textInput"
              value={form.tts_model_path ?? ""}
              onChange={(e) => onSetField("tts_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.omniTtsModelDir")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.voxTtsModelDir")}</label>
            <input
              className="textInput"
              value={form.voxcpm_tts_model_path ?? "openbmb/VoxCPM2"}
              onChange={(e) => onSetField("voxcpm_tts_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.voxTtsModelDir")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.musicTurboModelDir")}</label>
            <input
              className="textInput"
              value={form.music_turbo_model_dir ?? form.music_model_dir ?? ""}
              onChange={(e) => onSetField("music_turbo_model_dir", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.musicTurboModelDir")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.musicBaseModelDir")}</label>
            <input
              className="textInput"
              value={form.music_base_model_dir ?? form.music_model_dir ?? ""}
              onChange={(e) => onSetField("music_base_model_dir", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.musicBaseModelDir")}
            />
          </div>

          <label
            className="controlRow"
            style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.music_enabled ?? false)}
              onChange={(e) => onSetField("music_enabled", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{t("settings.orchestrator.enableMusic")}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settings.orchestrator.enableMusicHint")}</span>
            </div>
          </label>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.musicDeviceMode")}</label>
            <select
              className="textInput"
              value={form.music_device_mode ?? "cpu_offload"}
              onChange={(e) => onSetField("music_device_mode", e.target.value)}
            >
              <option value="cpu_offload">{t("settings.orchestrator.option.musicDevice.cpuOffload")}</option>
              <option value="cuda">{t("settings.orchestrator.option.musicDevice.cuda")}</option>
              <option value="cpu">{t("settings.orchestrator.option.musicDevice.cpu")}</option>
            </select>
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.asrModelPath")}</label>
            <input
              className="textInput"
              value={form.asr_model_path ?? "base"}
              onChange={(e) => onSetField("asr_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.asrModelPath")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.crispAsrExe")}</label>
            <input
              className="textInput"
              value={form.qwen3_asr_crispasr_exe ?? ""}
              onChange={(e) => onSetField("qwen3_asr_crispasr_exe", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.crispAsrExe")}
            />
          </div>
          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.qwen3AsrModel")}</label>
            <input
              className="textInput"
              value={form.qwen3_asr_model_path ?? ""}
              onChange={(e) => onSetField("qwen3_asr_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.qwen3AsrModel")}
            />
          </div>
          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.qwen3ForcedAlignerModel")}</label>
            <input
              className="textInput"
              value={form.qwen3_asr_forced_aligner_model_path ?? ""}
              onChange={(e) => onSetField("qwen3_asr_forced_aligner_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.qwen3ForcedAlignerModel")}
            />
          </div>
          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.threadCount")}</label>
              <input
                className="textInput"
                type="number"
                min="0"
                step="1"
                value={form.qwen3_asr_threads ?? 0}
                onChange={(e) => onSetField("qwen3_asr_threads", e.target.value)}
                placeholder={t("settings.orchestrator.placeholder.threadCount")}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.language")}</label>
              <input
                className="textInput"
                value={form.qwen3_asr_language ?? "auto"}
                onChange={(e) => onSetField("qwen3_asr_language", e.target.value)}
                placeholder={t("settings.orchestrator.placeholder.language")}
              />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.pyannoteModelId")}</label>
            <input
              className="textInput"
              value={form.pyannote_model_id ?? "pyannote/speaker-diarization-community-1"}
              onChange={(e) => onSetField("pyannote_model_id", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.pyannoteModelId")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.pyannoteAuthToken")}</label>
            <input
              className="textInput"
              type="password"
              value={form.pyannote_auth_token ?? ""}
              onChange={(e) => onSetField("pyannote_auth_token", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.pyannoteAuthToken")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.pyannoteDevice")}</label>
            <input
              className="textInput"
              value={form.pyannote_device ?? "cuda:0"}
              onChange={(e) => onSetField("pyannote_device", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.pyannoteDevice")}
            />
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.temperature")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="2" value={form.llm_temperature ?? 0.2} onChange={(e) => onSetField("llm_temperature", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.topP")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_top_p ?? 0.9} onChange={(e) => onSetField("llm_top_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.topK")}</label>
              <input className="textInput" type="number" step="1" min="0" value={form.llm_top_k ?? 40} onChange={(e) => onSetField("llm_top_k", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.minP")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_min_p ?? 0} onChange={(e) => onSetField("llm_min_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.presencePenalty")}</label>
              <input className="textInput" type="number" step="0.01" min="-2" max="2" value={form.llm_presence_penalty ?? 0} onChange={(e) => onSetField("llm_presence_penalty", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.repeatPenalty")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="3" value={form.llm_repeat_penalty ?? 1} onChange={(e) => onSetField("llm_repeat_penalty", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.ctxSize")}</label>
              <input className="textInput" type="number" step="1" min="256" value={form.llm_n_ctx ?? 8192} onChange={(e) => onSetField("llm_n_ctx", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.nLayerGpu")}</label>
              <input className="textInput" type="number" step="1" value={form.llm_n_gpu_layers ?? -1} onChange={(e) => onSetField("llm_n_gpu_layers", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.thread")}</label>
              <input className="textInput" type="number" step="1" min="0" value={form.llm_threads ?? 0} onChange={(e) => onSetField("llm_threads", e.target.value)} />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.maxOutToken")}</label>
            <input className="textInput" type="number" step="1" min="64" value={form.llm_max_tokens ?? 2048} onChange={(e) => onSetField("llm_max_tokens", e.target.value)} />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.secondaryModelPath")}</label>
            <input
              className="textInput"
              value={form.secondary_llm_model_path ?? ""}
              onChange={(e) => onSetField("secondary_llm_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.secondaryModelPath")}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.secondaryClipModelPath")}</label>
            <input
              className="textInput"
              value={form.secondary_llm_clip_model_path ?? ""}
              onChange={(e) => onSetField("secondary_llm_clip_model_path", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.secondaryClipModelPath")}
            />
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryTemperature")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="2" value={form.secondary_llm_temperature ?? 0.2} onChange={(e) => onSetField("secondary_llm_temperature", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryTopP")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.secondary_llm_top_p ?? 0.9} onChange={(e) => onSetField("secondary_llm_top_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryTopK")}</label>
              <input className="textInput" type="number" step="1" min="0" value={form.secondary_llm_top_k ?? 40} onChange={(e) => onSetField("secondary_llm_top_k", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryMinP")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.secondary_llm_min_p ?? 0} onChange={(e) => onSetField("secondary_llm_min_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryPresencePenalty")}</label>
              <input className="textInput" type="number" step="0.01" min="-2" max="2" value={form.secondary_llm_presence_penalty ?? 0} onChange={(e) => onSetField("secondary_llm_presence_penalty", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryRepeatPenalty")}</label>
              <input className="textInput" type="number" step="0.01" min="0" max="3" value={form.secondary_llm_repeat_penalty ?? 1} onChange={(e) => onSetField("secondary_llm_repeat_penalty", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryCtxSize")}</label>
              <input className="textInput" type="number" step="1" min="256" value={form.secondary_llm_n_ctx ?? 4096} onChange={(e) => onSetField("secondary_llm_n_ctx", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryNLayerGpu")}</label>
              <input className="textInput" type="number" step="1" value={form.secondary_llm_n_gpu_layers ?? -1} onChange={(e) => onSetField("secondary_llm_n_gpu_layers", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("settings.orchestrator.secondaryThread")}</label>
              <input className="textInput" type="number" step="1" min="0" value={form.secondary_llm_threads ?? 0} onChange={(e) => onSetField("secondary_llm_threads", e.target.value)} />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.secondaryMaxOutToken")}</label>
            <input className="textInput" type="number" step="1" min="64" value={form.secondary_llm_max_tokens ?? 1024} onChange={(e) => onSetField("secondary_llm_max_tokens", e.target.value)} />
          </div>

          <label
            className="controlRow"
            style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.secondary_enable_llama_cpp_think_mode ?? false)}
              onChange={(e) => onSetField("secondary_enable_llama_cpp_think_mode", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{t("settings.orchestrator.secondaryThinkMode")}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settings.orchestrator.secondaryThinkModeHint")}</span>
            </div>
          </label>

          <label
            className="controlRow"
            style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.auto_serial)}
              onChange={(e) => onSetField("auto_serial", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{t("settings.orchestrator.autoSerial")}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settings.orchestrator.autoSerialHint")}</span>
            </div>
          </label>

          <label
            className="controlRow"
            style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.debug_stale_report ?? false)}
              onChange={(e) => onSetField("debug_stale_report", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{t("settings.orchestrator.staleReportLog")}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settings.orchestrator.staleReportLogHint")}</span>
            </div>
          </label>

          <label
            className="controlRow"
            style={{ cursor: "pointer", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.enable_llama_cpp_think_mode ?? true)}
              onChange={(e) => onSetField("enable_llama_cpp_think_mode", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{t("settings.orchestrator.llamaThinkMode")}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settings.orchestrator.llamaThinkModeHint")}</span>
            </div>
          </label>

          <div className="formGroup">
            <label className="formLabel">{t("settings.orchestrator.defaultSystemPrompt")}</label>
            <textarea
              className="textArea"
              style={{ minHeight: 120, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
              value={form.default_system_prompt ?? ""}
              onChange={(e) => onSetField("default_system_prompt", e.target.value)}
              placeholder={t("settings.orchestrator.placeholder.defaultSystemPrompt")}
            />
          </div>

          <div className="controlRow">
            <Button variant="primary" disabled={isSaving} onClick={onSave}>
              {isSaving ? t("settings.common.saving") : t("settings.orchestrator.saveConfig")}
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={onSetAsDefault}>
              {t("settings.orchestrator.setAsDefault")}
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={onReset}>
              {t("settings.orchestrator.resetDefault")}
            </Button>
          </div>
        </>
      ) : (
        <div className="emptyState">
          <HardDrive size={28} style={{ color: "var(--text-muted)" }} />
          <span style={{ color: "var(--text-muted)" }}>{t("settings.orchestrator.loadingConfig")}</span>
        </div>
      )}
    </GlassCard>
  );
}
