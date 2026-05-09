import { HardDrive, Settings } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";

const llmBackendOptions = [
  { value: "llama_cpp", label: "llama.cpp (本地 GGUF)" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
  { value: "mock", label: "Mock (调试)" },
];

export default function OrchestratorConfigCard({ form, isSaving, onSetField, onSave, onSetAsDefault, onReset }) {
  return (
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
            <label className="formLabel">LLM 模型路径</label>
            <input
              className="textInput"
              value={form.llm_model_path ?? ""}
              onChange={(e) => onSetField("llm_model_path", e.target.value)}
              placeholder="e.g. D:/models/qwen2.5-7b-q4.gguf"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">LLM CLIP 模型路径（Qwen35ChatHandler 可选）</label>
            <input
              className="textInput"
              value={form.llm_clip_model_path ?? ""}
              onChange={(e) => onSetField("llm_clip_model_path", e.target.value)}
              placeholder="e.g. D:/models/mmproj/model.mmproj"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">LLM API 模型名（OpenAI/Gemini）</label>
            <input
              className="textInput"
              value={form.llm_api_model ?? ""}
              onChange={(e) => onSetField("llm_api_model", e.target.value)}
              placeholder="如 gpt-4.1-mini / gemini-2.5-flash"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">OmniVoice TTS 模型目录</label>
            <input
              className="textInput"
              value={form.tts_model_path ?? ""}
              onChange={(e) => onSetField("tts_model_path", e.target.value)}
              placeholder="e.g. D:/models/omnivoice"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">VoxCPM2 TTS 模型目录</label>
            <input
              className="textInput"
              value={form.voxcpm_tts_model_path ?? "openbmb/VoxCPM2"}
              onChange={(e) => onSetField("voxcpm_tts_model_path", e.target.value)}
              placeholder="openbmb/VoxCPM2 或 E:/models/VoxCPM2"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">Music Turbo 模型目录（ACE-Step Diffusers）</label>
            <input
              className="textInput"
              value={form.music_turbo_model_dir ?? form.music_model_dir ?? ""}
              onChange={(e) => onSetField("music_turbo_model_dir", e.target.value)}
              placeholder="e.g. D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">Music Base 模型目录（ACE-Step Diffusers）</label>
            <input
              className="textInput"
              value={form.music_base_model_dir ?? form.music_model_dir ?? ""}
              onChange={(e) => onSetField("music_base_model_dir", e.target.value)}
              placeholder="e.g. D:/AIModels/ACE-Step/acestep-v15-xl-base-diffusers"
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
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>启用音乐生成</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>关闭时禁止 music API 任务提交</span>
            </div>
          </label>

          <div className="formGroup">
            <label className="formLabel">Music 设备模式</label>
            <select
              className="textInput"
              value={form.music_device_mode ?? "cpu_offload"}
              onChange={(e) => onSetField("music_device_mode", e.target.value)}
            >
              <option value="cpu_offload">cpu_offload (推荐)</option>
              <option value="cuda">cuda</option>
              <option value="cpu">cpu</option>
            </select>
          </div>

          <div className="formGroup">
            <label className="formLabel">ASR 模型目录/名称</label>
            <input
              className="textInput"
              value={form.asr_model_path ?? "base"}
              onChange={(e) => onSetField("asr_model_path", e.target.value)}
              placeholder="如 E:/models/faster-whisper-large-v3 或 base"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">CrispASR 可执行文件</label>
            <input
              className="textInput"
              value={form.qwen3_asr_crispasr_exe ?? ""}
              onChange={(e) => onSetField("qwen3_asr_crispasr_exe", e.target.value)}
              placeholder="如 D:/tools/CrispASR/build/bin/crispasr.exe"
            />
          </div>
          <div className="formGroup">
            <label className="formLabel">Qwen3-ASR GGUF 模型</label>
            <input
              className="textInput"
              value={form.qwen3_asr_model_path ?? ""}
              onChange={(e) => onSetField("qwen3_asr_model_path", e.target.value)}
              placeholder="如 D:/models/qwen3-asr-0.6b-q4_k.gguf"
            />
          </div>
          <div className="formGroup">
            <label className="formLabel">Qwen3-ForcedAligner GGUF（可选）</label>
            <input
              className="textInput"
              value={form.qwen3_asr_forced_aligner_model_path ?? ""}
              onChange={(e) => onSetField("qwen3_asr_forced_aligner_model_path", e.target.value)}
              placeholder="如 D:/models/qwen3-forced-aligner-0.6b-q4_k.gguf"
            />
          </div>
          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">线程数</label>
              <input
                className="textInput"
                type="number"
                min="0"
                step="1"
                value={form.qwen3_asr_threads ?? 0}
                onChange={(e) => onSetField("qwen3_asr_threads", e.target.value)}
                placeholder="0 表示默认"
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">语言</label>
              <input
                className="textInput"
                value={form.qwen3_asr_language ?? "auto"}
                onChange={(e) => onSetField("qwen3_asr_language", e.target.value)}
                placeholder="auto / zh / en"
              />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">pyannote 模型 ID</label>
            <input
              className="textInput"
              value={form.pyannote_model_id ?? "pyannote/speaker-diarization-community-1"}
              onChange={(e) => onSetField("pyannote_model_id", e.target.value)}
              placeholder="如 pyannote/speaker-diarization-community-1"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">pyannote 认证 Token</label>
            <input
              className="textInput"
              type="password"
              value={form.pyannote_auth_token ?? ""}
              onChange={(e) => onSetField("pyannote_auth_token", e.target.value)}
              placeholder="Hugging Face token"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">pyannote 设备</label>
            <input
              className="textInput"
              value={form.pyannote_device ?? "cuda:0"}
              onChange={(e) => onSetField("pyannote_device", e.target.value)}
              placeholder="如 cuda:0 或 cpu"
            />
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">temperature</label>
              <input className="textInput" type="number" step="0.01" min="0" max="2" value={form.llm_temperature ?? 0.2} onChange={(e) => onSetField("llm_temperature", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">top_p</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_top_p ?? 0.9} onChange={(e) => onSetField("llm_top_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">top_k</label>
              <input className="textInput" type="number" step="1" min="0" value={form.llm_top_k ?? 40} onChange={(e) => onSetField("llm_top_k", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">min_p</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.llm_min_p ?? 0} onChange={(e) => onSetField("llm_min_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">presence_penalty</label>
              <input className="textInput" type="number" step="0.01" min="-2" max="2" value={form.llm_presence_penalty ?? 0} onChange={(e) => onSetField("llm_presence_penalty", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">repeat_penalty</label>
              <input className="textInput" type="number" step="0.01" min="0" max="3" value={form.llm_repeat_penalty ?? 1} onChange={(e) => onSetField("llm_repeat_penalty", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">ctx-size (n_ctx)</label>
              <input className="textInput" type="number" step="1" min="256" value={form.llm_n_ctx ?? 8192} onChange={(e) => onSetField("llm_n_ctx", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">n-layer (GPU)</label>
              <input className="textInput" type="number" step="1" value={form.llm_n_gpu_layers ?? -1} onChange={(e) => onSetField("llm_n_gpu_layers", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">thread</label>
              <input className="textInput" type="number" step="1" min="0" value={form.llm_threads ?? 0} onChange={(e) => onSetField("llm_threads", e.target.value)} />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">max out token</label>
            <input className="textInput" type="number" step="1" min="64" value={form.llm_max_tokens ?? 2048} onChange={(e) => onSetField("llm_max_tokens", e.target.value)} />
          </div>

          <div className="formGroup">
            <label className="formLabel">第二LLM模型路径（翻译润色）</label>
            <input
              className="textInput"
              value={form.secondary_llm_model_path ?? ""}
              onChange={(e) => onSetField("secondary_llm_model_path", e.target.value)}
              placeholder="e.g. D:/models/qwen2.5-1.5b-q4.gguf"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">第二LLM CLIP模型路径（可选）</label>
            <input
              className="textInput"
              value={form.secondary_llm_clip_model_path ?? ""}
              onChange={(e) => onSetField("secondary_llm_clip_model_path", e.target.value)}
              placeholder="e.g. D:/models/mmproj/secondary.mmproj"
            />
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">第二模型 temperature</label>
              <input className="textInput" type="number" step="0.01" min="0" max="2" value={form.secondary_llm_temperature ?? 0.2} onChange={(e) => onSetField("secondary_llm_temperature", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 top_p</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.secondary_llm_top_p ?? 0.9} onChange={(e) => onSetField("secondary_llm_top_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 top_k</label>
              <input className="textInput" type="number" step="1" min="0" value={form.secondary_llm_top_k ?? 40} onChange={(e) => onSetField("secondary_llm_top_k", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">第二模型 min_p</label>
              <input className="textInput" type="number" step="0.01" min="0" max="1" value={form.secondary_llm_min_p ?? 0} onChange={(e) => onSetField("secondary_llm_min_p", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 presence_penalty</label>
              <input className="textInput" type="number" step="0.01" min="-2" max="2" value={form.secondary_llm_presence_penalty ?? 0} onChange={(e) => onSetField("secondary_llm_presence_penalty", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 repeat_penalty</label>
              <input className="textInput" type="number" step="0.01" min="0" max="3" value={form.secondary_llm_repeat_penalty ?? 1} onChange={(e) => onSetField("secondary_llm_repeat_penalty", e.target.value)} />
            </div>
          </div>

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">第二模型 ctx-size (n_ctx)</label>
              <input className="textInput" type="number" step="1" min="256" value={form.secondary_llm_n_ctx ?? 4096} onChange={(e) => onSetField("secondary_llm_n_ctx", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 n-layer (GPU)</label>
              <input className="textInput" type="number" step="1" value={form.secondary_llm_n_gpu_layers ?? -1} onChange={(e) => onSetField("secondary_llm_n_gpu_layers", e.target.value)} />
            </div>
            <div className="formGroup">
              <label className="formLabel">第二模型 thread</label>
              <input className="textInput" type="number" step="1" min="0" value={form.secondary_llm_threads ?? 0} onChange={(e) => onSetField("secondary_llm_threads", e.target.value)} />
            </div>
          </div>

          <div className="formGroup">
            <label className="formLabel">第二模型 max out token</label>
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
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>第二模型启用 Think 模式</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>仅影响翻译润色使用的第二模型</span>
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
              checked={Boolean(form.debug_stale_report ?? false)}
              onChange={(e) => onSetField("debug_stale_report", e.target.checked)}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>启用 stale-report 调试日志</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>输出缺失音频、stale 原因和 fingerprint 匹配详情，默认关闭</span>
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
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>启用 llama-cpp-python Think 模式</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>切换 Qwen 模型推理是否启用思考模板</span>
            </div>
          </label>

          <div className="formGroup">
            <label className="formLabel">LLM 系统提示词（默认）</label>
            <textarea
              className="textArea"
              style={{ minHeight: 120, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
              value={form.default_system_prompt ?? ""}
              onChange={(e) => onSetField("default_system_prompt", e.target.value)}
              placeholder="留空使用内置提示词"
            />
          </div>

          <div className="controlRow">
            <Button variant="primary" disabled={isSaving} onClick={onSave}>
              {isSaving ? "保存中..." : "保存配置"}
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={onSetAsDefault}>
              设为默认
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={onReset}>
              Reset 默认
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
  );
}
