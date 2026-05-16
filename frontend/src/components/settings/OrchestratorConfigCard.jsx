import { HardDrive, RotateCcw, Save, Settings, Star } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";

const llmBackendOptions = [
  { value: "llama_cpp", label: "llama.cpp (本地 GGUF)" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
  { value: "mock", label: "Mock (调试)" },
];

const musicDeviceOptions = [
  { value: "cpu_offload", label: "cpu_offload (推荐)" },
  { value: "cuda", label: "cuda" },
  { value: "cpu", label: "cpu" },
];

const asrBackendOptions = [
  { value: "whisper", label: "Whisper" },
  { value: "qwen3_crispasr", label: "Qwen3 CrispASR" },
];

function Field({ id, label, children, className = "" }) {
  return (
    <div className={`formGroup ${className}`}>
      <label className="formLabel" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function TextField({ id, label, value, onChange, placeholder, type = "text" }) {
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        name={id}
        className="textInput"
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}

function NumberField({ id, label, value, onChange, min, max, step = "1" }) {
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        name={id}
        className="textInput"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </Field>
  );
}

function SelectField({ id, label, value, onChange, options }) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        name={id}
        className="textInput"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      >
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ToggleRow({ id, checked, onChange, title, description }) {
  return (
    <label className="settingsToggleRow" htmlFor={id}>
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settingsToggleCopy">
        <span>{title}</span>
        <small>{description}</small>
      </span>
    </label>
  );
}

function SettingsGroup({ title, description, children }) {
  return (
    <section className="settingsConfigGroup" aria-labelledby={`${title}-title`}>
      <div className="settingsConfigGroupHeader">
        <h3 id={`${title}-title`}>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settingsConfigFields">{children}</div>
    </section>
  );
}

export default function OrchestratorConfigCard({ form, isSaving, onSetField, onSave, onSetAsDefault, onReset }) {
  return (
    <GlassCard className="settingsConfigCard">
      <div className="sectionHeader">
        <div className="sectionHeaderLeft">
          <h2 className="cardTitle">
            <Settings size={16} /> 模型调度配置
          </h2>
          <p className="cardSubtitle">保存模型路径、后端选择和运行参数。</p>
        </div>
        {form ? (
          <Button variant="primary" size="sm" icon={Save} disabled={isSaving} onClick={onSave}>
            {isSaving ? "保存中…" : "保存配置"}
          </Button>
        ) : null}
      </div>

      {form ? (
        <>
          <Tabs defaultValue="llm" className="settingsTabs">
            <TabsList className="settingsTabsList">
              <TabsTrigger value="llm">LLM</TabsTrigger>
              <TabsTrigger value="media">语音与音乐</TabsTrigger>
              <TabsTrigger value="advanced">高级参数</TabsTrigger>
            </TabsList>

            <TabsContent value="llm" className="settingsTabPanel">
              <SettingsGroup title="主模型" description="选择推理后端，并配置本地模型或 API 模型名。">
                <SelectField
                  id="llm-backend"
                  label="LLM 后端"
                  value={form.llm_backend ?? "llama_cpp"}
                  onChange={(value) => onSetField("llm_backend", value)}
                  options={llmBackendOptions}
                />
                <TextField
                  id="llm-model-path"
                  label="LLM 模型路径"
                  value={form.llm_model_path}
                  onChange={(value) => onSetField("llm_model_path", value)}
                  placeholder="例如 D:/models/qwen2.5-7b-q4.gguf…"
                />
                <TextField
                  id="llm-clip-model-path"
                  label="LLM CLIP 模型路径（Qwen35ChatHandler 可选）"
                  value={form.llm_clip_model_path}
                  onChange={(value) => onSetField("llm_clip_model_path", value)}
                  placeholder="例如 D:/models/mmproj/model.mmproj…"
                />
                <TextField
                  id="llm-api-model"
                  label="LLM API 模型名（OpenAI/Gemini）"
                  value={form.llm_api_model}
                  onChange={(value) => onSetField("llm_api_model", value)}
                  placeholder="例如 gpt-4.1-mini 或 gemini-2.5-flash…"
                />
                <ToggleRow
                  id="enable-llama-cpp-think-mode"
                  checked={form.enable_llama_cpp_think_mode ?? true}
                  onChange={(value) => onSetField("enable_llama_cpp_think_mode", value)}
                  title="启用 llama-cpp-python Think 模式"
                  description="切换 Qwen 模型推理是否启用思考模板。"
                />
              </SettingsGroup>

              <SettingsGroup title="小模型" description="用于翻译润色等辅助任务，可与主模型分开配置。">
                <TextField
                  id="secondary-llm-model-path"
                  label="小模型 LLM 模型路径（翻译润色）"
                  value={form.secondary_llm_model_path}
                  onChange={(value) => onSetField("secondary_llm_model_path", value)}
                  placeholder="例如 D:/models/qwen2.5-1.5b-q4.gguf…"
                />
                <TextField
                  id="secondary-llm-clip-model-path"
                  label="小模型 LLM CLIP 模型路径（可选）"
                  value={form.secondary_llm_clip_model_path}
                  onChange={(value) => onSetField("secondary_llm_clip_model_path", value)}
                  placeholder="例如 D:/models/mmproj/secondary.mmproj…"
                />
                <ToggleRow
                  id="secondary-enable-think-mode"
                  checked={form.secondary_enable_llama_cpp_think_mode ?? false}
                  onChange={(value) => onSetField("secondary_enable_llama_cpp_think_mode", value)}
                  title="小模型启用 Think 模式"
                  description="仅影响翻译润色使用的小模型。"
                />
              </SettingsGroup>

              <SettingsGroup title="系统提示词" description="留空时使用内置提示词。">
                <Field id="default-system-prompt" label="LLM 系统提示词（默认）">
                  <textarea
                    id="default-system-prompt"
                    name="default-system-prompt"
                    className="textArea codeArea settingsPromptArea"
                    value={form.default_system_prompt ?? ""}
                    onChange={(e) => onSetField("default_system_prompt", e.target.value)}
                    placeholder="留空使用内置提示词…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </SettingsGroup>
            </TabsContent>

            <TabsContent value="media" className="settingsTabPanel">
              <SettingsGroup title="TTS" description="配置语音合成模型目录与运行设备。">
                <TextField
                  id="tts-model-path"
                  label="OmniVoice TTS 模型目录"
                  value={form.tts_model_path}
                  onChange={(value) => onSetField("tts_model_path", value)}
                  placeholder="例如 D:/models/omnivoice…"
                />
                <TextField
                  id="voxcpm-tts-model-path"
                  label="VoxCPM2 TTS 模型目录"
                  value={form.voxcpm_tts_model_path ?? "openbmb/VoxCPM2"}
                  onChange={(value) => onSetField("voxcpm_tts_model_path", value)}
                  placeholder="例如 openbmb/VoxCPM2 或 E:/models/VoxCPM2…"
                />
                <TextField
                  id="tts-device"
                  label="TTS 设备"
                  value={form.tts_device ?? "cuda:0"}
                  onChange={(value) => onSetField("tts_device", value)}
                  placeholder="例如 cuda:0 或 cpu…"
                />
              </SettingsGroup>

              <SettingsGroup title="Music" description="配置 ACE-Step 模型目录和生成设备策略。">
                <ToggleRow
                  id="music-enabled"
                  checked={form.music_enabled ?? false}
                  onChange={(value) => onSetField("music_enabled", value)}
                  title="启用音乐生成"
                  description="关闭时禁止 music API 任务提交。"
                />
                <TextField
                  id="music-turbo-model-dir"
                  label="Music Turbo 模型目录（ACE-Step Diffusers）"
                  value={form.music_turbo_model_dir ?? form.music_model_dir}
                  onChange={(value) => onSetField("music_turbo_model_dir", value)}
                  placeholder="例如 D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers…"
                />
                <TextField
                  id="music-base-model-dir"
                  label="Music Base 模型目录（ACE-Step Diffusers）"
                  value={form.music_base_model_dir ?? form.music_model_dir}
                  onChange={(value) => onSetField("music_base_model_dir", value)}
                  placeholder="例如 D:/AIModels/ACE-Step/acestep-v15-xl-base-diffusers…"
                />
                <SelectField
                  id="music-device-mode"
                  label="Music 设备模式"
                  value={form.music_device_mode ?? "cpu_offload"}
                  onChange={(value) => onSetField("music_device_mode", value)}
                  options={musicDeviceOptions}
                />
              </SettingsGroup>

              <SettingsGroup title="ASR" description="配置语音识别后端、Qwen3-ASR 和说话人分离。">
                <SelectField
                  id="asr-backend"
                  label="ASR 后端"
                  value={form.asr_backend ?? "whisper"}
                  onChange={(value) => onSetField("asr_backend", value)}
                  options={asrBackendOptions}
                />
                <TextField
                  id="asr-model-path"
                  label="ASR 模型目录/名称"
                  value={form.asr_model_path ?? "base"}
                  onChange={(value) => onSetField("asr_model_path", value)}
                  placeholder="例如 E:/models/faster-whisper-large-v3 或 base…"
                />
                <TextField
                  id="asr-device"
                  label="ASR 设备"
                  value={form.asr_device ?? "cuda:0"}
                  onChange={(value) => onSetField("asr_device", value)}
                  placeholder="例如 cuda:0 或 cpu…"
                />
                <TextField
                  id="qwen3-asr-crispasr-exe"
                  label="CrispASR 可执行文件"
                  value={form.qwen3_asr_crispasr_exe}
                  onChange={(value) => onSetField("qwen3_asr_crispasr_exe", value)}
                  placeholder="例如 D:/tools/CrispASR/build/bin/crispasr.exe…"
                />
                <TextField
                  id="qwen3-asr-model-path"
                  label="Qwen3-ASR GGUF 模型"
                  value={form.qwen3_asr_model_path}
                  onChange={(value) => onSetField("qwen3_asr_model_path", value)}
                  placeholder="例如 D:/models/qwen3-asr-0.6b-q4_k.gguf…"
                />
                <TextField
                  id="qwen3-asr-forced-aligner-model-path"
                  label="Qwen3-ForcedAligner GGUF（可选）"
                  value={form.qwen3_asr_forced_aligner_model_path}
                  onChange={(value) => onSetField("qwen3_asr_forced_aligner_model_path", value)}
                  placeholder="例如 D:/models/qwen3-forced-aligner-0.6b-q4_k.gguf…"
                />
                <div className="editorGrid three settingsFieldGrid">
                  <NumberField
                    id="qwen3-asr-threads"
                    label="线程数"
                    min="0"
                    value={form.qwen3_asr_threads ?? 0}
                    onChange={(value) => onSetField("qwen3_asr_threads", value)}
                  />
                  <TextField
                    id="qwen3-asr-language"
                    label="语言"
                    value={form.qwen3_asr_language ?? "auto"}
                    onChange={(value) => onSetField("qwen3_asr_language", value)}
                    placeholder="auto / zh / en…"
                  />
                </div>
                <ToggleRow
                  id="qwen3-asr-enable-timestamps"
                  checked={form.qwen3_asr_enable_timestamps ?? false}
                  onChange={(value) => onSetField("qwen3_asr_enable_timestamps", value)}
                  title="启用 Qwen3-ASR 时间戳"
                  description="让识别结果携带更细的时间信息。"
                />
                <TextField
                  id="pyannote-model-id"
                  label="pyannote 模型 ID"
                  value={form.pyannote_model_id ?? "pyannote/speaker-diarization-community-1"}
                  onChange={(value) => onSetField("pyannote_model_id", value)}
                  placeholder="例如 pyannote/speaker-diarization-community-1…"
                />
                <TextField
                  id="pyannote-auth-token"
                  label="pyannote 认证 Token"
                  type="password"
                  value={form.pyannote_auth_token}
                  onChange={(value) => onSetField("pyannote_auth_token", value)}
                  placeholder="填写 Hugging Face token…"
                />
                <TextField
                  id="pyannote-device"
                  label="pyannote 设备"
                  value={form.pyannote_device ?? "cuda:0"}
                  onChange={(value) => onSetField("pyannote_device", value)}
                  placeholder="例如 cuda:0 或 cpu…"
                />
              </SettingsGroup>
            </TabsContent>

            <TabsContent value="advanced" className="settingsTabPanel">
              <SettingsGroup title="运行策略" description="控制模型切换、自动卸载和调试日志。">
                <ToggleRow
                  id="auto-serial"
                  checked={form.auto_serial}
                  onChange={(value) => onSetField("auto_serial", value)}
                  title="自动串行模式"
                  description="解析完成后自动卸载 LLM，再加载 TTS。"
                />
                <ToggleRow
                  id="auto-unload-llm-after-parse"
                  checked={form.auto_unload_llm_after_parse ?? true}
                  onChange={(value) => onSetField("auto_unload_llm_after_parse", value)}
                  title="解析后自动卸载 LLM"
                  description="为后续 TTS 或音乐任务释放显存。"
                />
                <ToggleRow
                  id="auto-load-tts-before-synth"
                  checked={form.auto_load_tts_before_synth ?? true}
                  onChange={(value) => onSetField("auto_load_tts_before_synth", value)}
                  title="合成前自动加载 TTS"
                  description="进入语音合成流程时自动准备 TTS 模型。"
                />
                <ToggleRow
                  id="debug-stale-report"
                  checked={form.debug_stale_report ?? false}
                  onChange={(value) => onSetField("debug_stale_report", value)}
                  title="启用 stale-report 调试日志"
                  description="输出缺失音频、stale 原因和 fingerprint 匹配详情，默认关闭。"
                />
              </SettingsGroup>

              <SettingsGroup title="主模型采样参数" description="控制主模型输出长度、上下文和随机性。">
                <div className="editorGrid three settingsFieldGrid">
                  <NumberField id="llm-temperature" label="temperature" step="0.01" min="0" max="2" value={form.llm_temperature ?? 0.2} onChange={(value) => onSetField("llm_temperature", value)} />
                  <NumberField id="llm-top-p" label="top_p" step="0.01" min="0" max="1" value={form.llm_top_p ?? 0.9} onChange={(value) => onSetField("llm_top_p", value)} />
                  <NumberField id="llm-top-k" label="top_k" min="0" value={form.llm_top_k ?? 40} onChange={(value) => onSetField("llm_top_k", value)} />
                  <NumberField id="llm-min-p" label="min_p" step="0.01" min="0" max="1" value={form.llm_min_p ?? 0} onChange={(value) => onSetField("llm_min_p", value)} />
                  <NumberField id="llm-presence-penalty" label="presence_penalty" step="0.01" min="-2" max="2" value={form.llm_presence_penalty ?? 0} onChange={(value) => onSetField("llm_presence_penalty", value)} />
                  <NumberField id="llm-repeat-penalty" label="repeat_penalty" step="0.01" min="0" max="3" value={form.llm_repeat_penalty ?? 1} onChange={(value) => onSetField("llm_repeat_penalty", value)} />
                  <NumberField id="llm-n-ctx" label="ctx-size (n_ctx)" min="256" value={form.llm_n_ctx ?? 8192} onChange={(value) => onSetField("llm_n_ctx", value)} />
                  <NumberField id="llm-n-gpu-layers" label="n-layer (GPU)" value={form.llm_n_gpu_layers ?? -1} onChange={(value) => onSetField("llm_n_gpu_layers", value)} />
                  <NumberField id="llm-threads" label="thread" min="0" value={form.llm_threads ?? 0} onChange={(value) => onSetField("llm_threads", value)} />
                </div>
                <NumberField
                  id="llm-max-tokens"
                  label="max out token"
                  min="64"
                  value={form.llm_max_tokens ?? 2048}
                  onChange={(value) => onSetField("llm_max_tokens", value)}
                />
              </SettingsGroup>

              <SettingsGroup title="小模型采样参数" description="单独控制翻译润色小模型的生成行为。">
                <div className="editorGrid three settingsFieldGrid">
                  <NumberField id="secondary-llm-temperature" label="小模型 temperature" step="0.01" min="0" max="2" value={form.secondary_llm_temperature ?? 0.2} onChange={(value) => onSetField("secondary_llm_temperature", value)} />
                  <NumberField id="secondary-llm-top-p" label="小模型 top_p" step="0.01" min="0" max="1" value={form.secondary_llm_top_p ?? 0.9} onChange={(value) => onSetField("secondary_llm_top_p", value)} />
                  <NumberField id="secondary-llm-top-k" label="小模型 top_k" min="0" value={form.secondary_llm_top_k ?? 40} onChange={(value) => onSetField("secondary_llm_top_k", value)} />
                  <NumberField id="secondary-llm-min-p" label="小模型 min_p" step="0.01" min="0" max="1" value={form.secondary_llm_min_p ?? 0} onChange={(value) => onSetField("secondary_llm_min_p", value)} />
                  <NumberField id="secondary-llm-presence-penalty" label="小模型 presence_penalty" step="0.01" min="-2" max="2" value={form.secondary_llm_presence_penalty ?? 0} onChange={(value) => onSetField("secondary_llm_presence_penalty", value)} />
                  <NumberField id="secondary-llm-repeat-penalty" label="小模型 repeat_penalty" step="0.01" min="0" max="3" value={form.secondary_llm_repeat_penalty ?? 1} onChange={(value) => onSetField("secondary_llm_repeat_penalty", value)} />
                  <NumberField id="secondary-llm-n-ctx" label="小模型 ctx-size (n_ctx)" min="256" value={form.secondary_llm_n_ctx ?? 4096} onChange={(value) => onSetField("secondary_llm_n_ctx", value)} />
                  <NumberField id="secondary-llm-n-gpu-layers" label="小模型 n-layer (GPU)" value={form.secondary_llm_n_gpu_layers ?? -1} onChange={(value) => onSetField("secondary_llm_n_gpu_layers", value)} />
                  <NumberField id="secondary-llm-threads" label="小模型 thread" min="0" value={form.secondary_llm_threads ?? 0} onChange={(value) => onSetField("secondary_llm_threads", value)} />
                </div>
                <NumberField
                  id="secondary-llm-max-tokens"
                  label="小模型 max out token"
                  min="64"
                  value={form.secondary_llm_max_tokens ?? 1024}
                  onChange={(value) => onSetField("secondary_llm_max_tokens", value)}
                />
              </SettingsGroup>
            </TabsContent>
          </Tabs>

          <div className="settingsActionBar">
            <Button variant="primary" icon={Save} disabled={isSaving} onClick={onSave}>
              {isSaving ? "保存中…" : "保存配置"}
            </Button>
            <Button variant="secondary" icon={Star} disabled={isSaving} onClick={onSetAsDefault}>
              设为默认
            </Button>
            <Button variant="secondary" icon={RotateCcw} disabled={isSaving} onClick={onReset}>
              恢复默认
            </Button>
          </div>
        </>
      ) : (
        <div className="emptyState" aria-live="polite">
          <HardDrive size={28} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
          <span style={{ color: "var(--text-muted)" }}>正在加载配置…</span>
        </div>
      )}
    </GlassCard>
  );
}
