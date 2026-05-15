# VoxCPM2 合成链路支持落地计划

## 1. 背景与目标

VoiceLace 当前已具备完整的文本解析、剧本编辑、声音配置、合成导出链路。VoxCPM2 的支持应作为新的 TTS 合成后端加入，不修改 LLM 解析链路，不修改快速解析 Step3 enrich prompt。

本次目标：

- OmniVoice 保持现有默认行为，旧项目、旧声音预设、旧合成参数不需要用户手动迁移。
- 系统设置新增 VoxCPM2 TTS 模型目录；现有 TTS 模型目录改明确为 OmniVoice TTS 模型目录。
- 合成导出页的合成参数改为 `OmniVoice` / `VoxCPM2` 两个 tab，选中哪个 tab，本次合成就使用哪个 TTS 后端。
- VoxCPM2 synthesis adapter 只在调用 VoxCPM2 `generate()` 前执行，负责处理 VoxCPM2 与 OmniVoice 在 non-verbal tag 和 phoneme input 上的差异。
- 声音配置采用单个逻辑 preset、双后端 profile 的模型：角色仍绑定一个 `preset_id`，合成时按当前 TTS 后端读取对应 profile。

明确不做：

- 不修改 `backend/engine/prompts.py` 的快速解析 Step3 prompt。
- 不新增 LLM 解析模式。
- 不做 vLLM HTTP、OpenAI-compatible audio speech 或 VoxCPM.cpp。
- 不把 TTS 后端选择放到系统设置作为全局当前后端；TTS 后端由每次合成的 `SynthesisConfig.tts_backend` 决定。

## 2. 数据模型与配置变更

### `backend/models/project.py`

扩展 `SynthesisConfig`，让它可以表达本次合成使用哪个 TTS 后端，以及每个后端自己的参数。

建议结构：

```python
class OmniVoiceSynthesisParams(BaseModel):
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True


class VoxCpm2SynthesisParams(BaseModel):
    inference_timesteps: int = 10
    cfg_value: float = 2.0
    denoise: bool = False
    normalize: bool = True


class SynthesisConfig(BaseModel):
    tts_backend: Literal["omnivoice", "voxcpm2"] = "omnivoice"

    # Backward-compatible legacy OmniVoice fields.
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True

    omnivoice: OmniVoiceSynthesisParams = Field(default_factory=OmniVoiceSynthesisParams)
    voxcpm2: VoxCpm2SynthesisParams = Field(default_factory=VoxCpm2SynthesisParams)

    gap_duration_ms: int = 300
    output_format: Literal["wav", "mp3"] = "wav"
```

兼容策略：

- 旧项目只有 `num_step/guidance_scale/denoise` 时，默认 `tts_backend="omnivoice"`。
- 读取配置时，若 `omnivoice` 缺失，则用旧顶层字段填充 `omnivoice`。
- 旧顶层字段保留，避免工程文件、测试和已有前端调用立即失效。
- 新代码取 OmniVoice 参数时优先读 `config.omnivoice`，没有时回退旧顶层字段。

### `backend/models/voice.py`

扩展 `VoicePreset`，支持单 preset 双 profile。

建议新增模型：

```python
class OmniVoicePresetProfile(BaseModel):
    voice_mode: Literal["clone", "design", "auto"] = "auto"
    ref_audio_path: str | None = None
    ref_text: str | None = None
    gender: str | None = None
    age: str | None = None
    pitch: str | None = None
    style: str | None = None
    accent: str | None = None
    dialect: str | None = None
    custom_instruct: str | None = None
    speed: float = 1.0
    clone_denoise: bool | None = None
    clone_num_step: int | None = None
    clone_guidance_scale: float | None = None


class VoxCpm2PresetProfile(BaseModel):
    voice_mode: Literal["clone", "design", "auto"] = "auto"
    design_instruction: str = ""
    ref_audio_path: str | None = None
    ref_text: str | None = None
    use_hifi_clone: bool = False
    cfg_value: float | None = None
    inference_timesteps: int | None = None
    denoise: bool | None = None


class VoiceBackendProfiles(BaseModel):
    omnivoice: OmniVoicePresetProfile | None = None
    voxcpm2: VoxCpm2PresetProfile | None = None
```

在 `VoicePreset` 增加：

```python
backend_profiles: VoiceBackendProfiles = Field(default_factory=VoiceBackendProfiles)
```

兼容策略：

- 旧字段继续保留为 base profile。
- 合成时解析 profile：
  - 当前后端为 `omnivoice`：优先 `preset.backend_profiles.omnivoice`，否则使用旧字段。
  - 当前后端为 `voxcpm2`：优先 `preset.backend_profiles.voxcpm2`，否则从旧字段生成保守 fallback。
- 角色绑定仍然只保存一个 `preset_id`，不要拆成两个独立 preset。

### `backend/models/api_models.py`

更新 `OrchestratorConfigPayload`：

- 保留 `tts_model_path`，语义改为 OmniVoice 模型目录。
- 新增 `voxcpm_tts_model_path: str = "openbmb/VoxCPM2"`。
- `SynthesizeRequest.config` 自动使用扩展后的 `SynthesisConfig`。

### `backend/config.py`

新增环境变量：

```env
BV_VOXCPM_TTS_MODEL_PATH=openbmb/VoxCPM2
```

新增 settings 字段：

```python
default_voxcpm_tts_model_path: str = field(
    default_factory=lambda: os.getenv("BV_VOXCPM_TTS_MODEL_PATH", "openbmb/VoxCPM2")
)
```

同步更新 `.env.example`：

```env
BV_TTS_MODEL_PATH=k2-fsa/OmniVoice
BV_VOXCPM_TTS_MODEL_PATH=openbmb/VoxCPM2
BV_TTS_DEVICE=cuda:0
```

### `backend/engine/model_orchestrator.py`

扩展 `OrchestratorConfig`：

```python
voxcpm_tts_model_path: str = settings.default_voxcpm_tts_model_path
```

修改 TTS ready 逻辑：

- `ensure_tts_ready()` 接收可选参数：

```python
async def ensure_tts_ready(self, *, tts_backend: str | None = None) -> None:
```

- 根据后端选择模型目录：
  - `omnivoice` 使用 `self._config.tts_model_path`
  - `voxcpm2` 使用 `self._config.voxcpm_tts_model_path`
- 调用 `self._tts.needs_reload(backend=..., model_path=..., device=...)`，当后端、模型目录、设备变化时卸载重载。
- 现有无参调用保持兼容，默认使用 `omnivoice`。

## 3. 后端 TTS Engine 与 VoxCPM2 Adapter

### `backend/engine/tts_engine.py`

保留现有 `TTSEngine` 对外方法：

- `load_model(model_path, device)`
- `unload_model()`
- `synthesize_to_file(text, output_path, preset, config, tts_overrides)`

新增：

```python
async def load_model(self, model_path: str, device: str, backend: str = "omnivoice") -> None
def needs_reload(self, *, backend: str, model_path: str, device: str) -> bool
```

`load_model()` 行为：

- `backend == "omnivoice"`：走现有 OmniVoice 逻辑。
- `backend == "voxcpm2"`：
  - import `VoxCPM` from `voxcpm`。
  - `self._model = VoxCPM.from_pretrained(model_path or "openbmb/VoxCPM2", load_denoiser=False, device=device)`。
  - `self.backend_name = "voxcpm2"`。
  - `self.sample_rate = getattr(self._model.tts_model, "sample_rate", 48000)`。
- import 或加载失败时沿用现有 mock fallback 策略；`BV_ALLOW_MOCK_FALLBACK=false` 时直接抛错。

`_synthesize_to_file_sync()` 行为：

- `self.backend_name == "omnivoice"`：保持现有逻辑。
- `self.backend_name == "voxcpm2"`：调用新的 VoxCPM2 分支。

### VoxCPM2 参数映射

OmniVoice 参数：

- `num_step -> OmniVoice generate(num_step=...)`
- `guidance_scale -> OmniVoice generate(guidance_scale=...)`
- `denoise -> OmniVoice generate(denoise=...)`

VoxCPM2 参数：

- `config.voxcpm2.inference_timesteps -> generate(inference_timesteps=...)`
- `config.voxcpm2.cfg_value -> generate(cfg_value=...)`
- `config.voxcpm2.denoise -> generate(denoise=...)`
- `config.voxcpm2.normalize -> generate(normalize=...)`

Clone preset override：

- 若 VoxCPM2 profile 中设置了 `inference_timesteps/cfg_value/denoise`，优先覆盖全局 VoxCPM2 参数。
- 若 segment `tts_overrides` 中有 `num_step/guidance_scale/denoise`，映射到 VoxCPM2：
  - `num_step -> inference_timesteps`
  - `guidance_scale -> cfg_value`
  - `denoise -> denoise`
- `speed/duration` 不作为 VoxCPM2 kwargs 传入，只转成文本 style instruction。

### VoxCPM2 Synthesis Adapter

建议新增文件：

```text
backend/engine/voxcpm2_adapter.py
```

职责：输入解析后的 segment text、emotion、non_verbal、tts_overrides、preset profile，输出 VoxCPM2 `generate()` 参数。

#### Non-Verbal Tag 规则

VoxCPM2 支持 tag：

```python
VOXCPM2_SUPPORTED_TAGS = {
    "laughing": "[laughing]",
    "sigh": "[sigh]",
    "uhm": "[Uhm]",
    "shh": "[Shh]",
    "question-ah": "[Question-ah]",
    "question-ei": "[Question-ei]",
    "question-en": "[Question-en]",
    "question-oh": "[Question-oh]",
    "surprise-wa": "[Surprise-wa]",
    "surprise-yo": "[Surprise-yo]",
    "dissatisfaction-hnn": "[Dissatisfaction-hnn]",
}
```

兼容映射：

```python
VOXCPM2_TAG_ALIASES = {
    "laughter": "laughing",
    "laugh": "laughing",
    "laughing": "laughing",
    "sigh": "sigh",
    "confirmation-en": "question-en",
    "question-ah": "question-ah",
    "question-ei": "question-ei",
    "question-en": "question-en",
    "question-oh": "question-oh",
    "surprise-wa": "surprise-wa",
    "surprise-yo": "surprise-yo",
    "dissatisfaction-hnn": "dissatisfaction-hnn",
}
```

必须实现：

- `[laughter] -> [laughing]`
- 保留 VoxCPM2 支持 tag。
- 删除不支持 tag，例如 `[question-yi]`、`[surprise-ah]`、`[surprise-oh]`。
- tag 大小写输出使用 VoxCPM2 推荐形式。
- 同一句内不要重复相同 tag。

#### Phoneme Input 规则

现有快速解析可能产生 `汉字PINYIN1` 形式，例如：

```text
朝CHAO2
```

VoxCPM2 需要花括号 phoneme，例如：

```text
{chao2}
```

转换规则：

- 匹配：`([\u4e00-\u9fff])([A-Z]{1,12}[1-5])`
- 输出：`{lowercase_pinyin_with_tone}`
- 示例：
  - `朝CHAO2 -> {chao2}`
  - `踅XUE2 -> {xue2}`
- 出现 `{...}` phoneme 时，最终 `generate(normalize=False)`。
- 未出现 phoneme 时，使用 config 中的 `normalize`，默认 `True`。

#### Style Instruction 规则

VoxCPM2 支持在文本前添加括号控制语：

```text
(年轻女性，温柔甜美)你好。
```

Adapter 生成 style instruction：

- design profile 的 `design_instruction` 优先。
- clone profile 可追加 emotion/speed style，例如：
  - `emotion=cheerful -> cheerful tone`
  - `emotion=sad/melancholy -> low and sad tone`
  - `tts_overrides.speed > 1.1 -> slightly faster`
  - `tts_overrides.speed < 0.9 -> slower`
- Hi-Fi cloning 模式下，VoxCPM2 文档说明 control instruction 会被忽略；此时不要依赖 style instruction 做强控制。

#### VoxCPM2 generate kwargs

Voice Design：

```python
wav = model.generate(
    text=f"({instruction}){adapted_text}",
    cfg_value=cfg_value,
    inference_timesteps=inference_timesteps,
    normalize=normalize,
    denoise=denoise,
)
```

Controllable Clone：

```python
wav = model.generate(
    text=f"({style_instruction}){adapted_text}",
    reference_wav_path=ref_audio_path,
    cfg_value=cfg_value,
    inference_timesteps=inference_timesteps,
    normalize=normalize,
    denoise=denoise,
)
```

Hi-Fi Clone：

```python
wav = model.generate(
    text=adapted_text,
    reference_wav_path=ref_audio_path,
    prompt_wav_path=ref_audio_path,
    prompt_text=ref_text,
    cfg_value=cfg_value,
    inference_timesteps=inference_timesteps,
    normalize=normalize,
    denoise=denoise,
)
```

## 4. 合成流水线、缓存与 Stale

### `backend/services/tts_pipeline_service.py`

修改合成任务：

- 从 `payload.config.tts_backend` 读取当前后端，默认 `omnivoice`。
- 调用：

```python
await state.orchestrator.ensure_tts_ready(tts_backend=config.tts_backend)
```

- `tts_backend` 不再从 `state.tts_engine.backend_name` 作为预期值，而是用 config 中的目标后端；加载后再读取 runtime backend 用于事件展示。
- `tts_model_path` 根据后端选择：
  - `omnivoice -> state.orchestrator.config.tts_model_path`
  - `voxcpm2 -> state.orchestrator.config.voxcpm_tts_model_path`

### `backend/services/tts_scan_service.py`

`segment_cache_key()` 已包含 `tts_backend` 和 `tts_model_path`，继续沿用。

需要调整：

- `config_hash` 要包含扩展后的 `SynthesisConfig`。
- 对旧 config 做稳定序列化，避免旧字段与新 `omnivoice` 默认重复造成无意义 hash 抖动。
- `preset_hash` 应使用当前后端 resolved profile，而不是整个 preset 的所有 backend_profiles；否则修改 VoxCPM2 profile 会让 OmniVoice 音频也 stale。

建议新增 helper：

```python
resolve_preset_for_backend(preset, backend) -> dict
```

### `backend/services/tts_stale_service.py`

继续使用现有 reason：

- `tts_backend_changed`
- `tts_model_changed`
- `synthesis_config_changed`
- `preset_changed`

需要调整：

- stale report 用当前项目 `project.synthesis_config.tts_backend` 判断。
- 若用户在合成页面切换 tab 但尚未保存项目，可以前端用当前 config 请求 stale report 的增强接口；若暂不做增强接口，则当前 stale report 只反映项目已保存 config。
- `preset_changed` 基于当前后端 resolved profile hash。

### `backend/services/tts_segment_service.py`

保持 `SegmentAsset.source_tts_backend`、`source_tts_model_path`、`source_config_hash` 写入。

需要确认：

- VoxCPM2 输出 sample rate 可能是 48000，拼接 full audio 时以实际 segment wav frame rate 更新 `sample_rate`。
- 如果一个任务中全部用同一后端，现有 sample rate 更新策略可继续使用。

## 5. 前端实现

### `frontend/src/components/settings/OrchestratorConfigCard.jsx`

改文案：

- `TTS 模型目录` -> `OmniVoice TTS 模型目录`

新增字段：

- `VoxCPM2 TTS 模型目录`
- 绑定 `form.voxcpm_tts_model_path`
- placeholder：`openbmb/VoxCPM2 或 E:/models/VoxCPM2`

不添加全局 TTS backend selector。

### `frontend/src/stores/useSettingsStore.js`

更新：

- `normalizeOrchestratorConfig()` 增加 `voxcpm_tts_model_path`。
- `toOrchestratorPayload()` 增加 `voxcpm_tts_model_path`。

### `frontend/src/components/synthesis/SynthesisConfigCard.jsx`

将合成参数改成 tabs：

- `OmniVoice`
- `VoxCPM2`

当前 tab：

```js
config.tts_backend || "omnivoice"
```

切换 tab：

```js
onSetConfig({ tts_backend: value })
```

OmniVoice tab：

- 绑定 `config.omnivoice.num_step`，同时兼容旧 `config.num_step`。
- 绑定 `config.omnivoice.guidance_scale`，同时兼容旧 `config.guidance_scale`。
- 绑定 `config.omnivoice.denoise`，同时兼容旧 `config.denoise`。

VoxCPM2 tab：

- `inference_timesteps` slider：4-30，默认 10。
- `cfg_value` slider：1.0-3.0，默认 2.0。
- `denoise` checkbox，默认 false。
- `normalize` checkbox，默认 true。
- 文案说明保持简短：phoneme 输入时后端会自动关闭 normalize。

共享参数：

- `gap_duration_ms`
- `output_format`
- 开始合成 / 停止按钮

### `frontend/src/stores/useSynthesisStore.js`

默认 config 改为：

```js
config: {
  tts_backend: "omnivoice",
  num_step: 32,
  guidance_scale: 2,
  denoise: true,
  omnivoice: {
    num_step: 32,
    guidance_scale: 2,
    denoise: true,
  },
  voxcpm2: {
    inference_timesteps: 10,
    cfg_value: 2,
    denoise: false,
    normalize: true,
  },
  gap_duration_ms: 300,
  output_format: "wav",
}
```

提交 payload 时直接传 `config`。

### 声音配置 UI

建议在 `frontend/src/pages/VoiceConfigPage.jsx` 中分阶段实现：

第一阶段可不重做整个 UI，只保证数据模型和合成 fallback 可用。

第二阶段增加 preset 后端 profile 编辑：

- 在声音预设编辑区域加 `OmniVoice Profile` / `VoxCPM2 Profile` tabs。
- OmniVoice profile 沿用现有 design/clone 表单。
- VoxCPM2 profile 提供：
  - `design_instruction`
  - `ref_audio_path`
  - `ref_text`
  - `use_hifi_clone`
  - 默认 `cfg_value`
  - 默认 `inference_timesteps`
  - 默认 `denoise`

## 6. 工程兼容与迁移

### 旧 `SynthesisConfig`

旧项目示例：

```json
{
  "num_step": 32,
  "guidance_scale": 2.0,
  "denoise": true,
  "gap_duration_ms": 300,
  "output_format": "wav"
}
```

读取后应等价于：

```json
{
  "tts_backend": "omnivoice",
  "omnivoice": {
    "num_step": 32,
    "guidance_scale": 2.0,
    "denoise": true
  },
  "voxcpm2": {
    "inference_timesteps": 10,
    "cfg_value": 2.0,
    "denoise": false,
    "normalize": true
  },
  "gap_duration_ms": 300,
  "output_format": "wav"
}
```

### 旧 `VoicePreset`

旧 preset 没有 `backend_profiles` 时：

- OmniVoice：直接使用旧字段。
- VoxCPM2：
  - `voice_mode=clone` 且有 `ref_audio_path`：作为 VoxCPM2 clone profile。
  - `ref_text` 存在时可启用 Hi-Fi clone 的必要参数，但默认 `use_hifi_clone=false`，除非 UI 明确设置。
  - design/auto：用旧字段拼出 `design_instruction`，例如 `gender, age, pitch, style, accent, dialect, custom_instruct`。

旧项目打开后无需手动迁移；保存后可以写入新字段。

### 工程导入导出

检查 project archive 导入导出逻辑：

- 确保 `synthesis_config` 的新字段能随 Pydantic model dump 保存。
- 确保 `VoicePreset.backend_profiles` 在 presets JSON 中保留。
- 旧 archive 导入不应失败。

## 7. 文件级修改清单

### 后端

- `backend/models/project.py`
  - 增加 OmniVoice/VoxCPM2 synthesis params。
  - 扩展 `SynthesisConfig`。

- `backend/models/voice.py`
  - 增加 backend profile models。
  - 扩展 `VoicePreset.backend_profiles`。
  - 增加 profile fallback/helper 方法，或在 engine helper 中实现。

- `backend/models/api_models.py`
  - 更新 `OrchestratorConfigPayload`，加入 `voxcpm_tts_model_path`。

- `backend/config.py`
  - 新增 `default_voxcpm_tts_model_path`。

- `backend/engine/model_orchestrator.py`
  - `OrchestratorConfig` 加 `voxcpm_tts_model_path`。
  - `ensure_tts_ready(tts_backend=...)` 支持按请求后端加载。

- `backend/engine/tts_engine.py`
  - 支持 `backend` 参数加载 OmniVoice/VoxCPM2。
  - 增加 `needs_reload()`。
  - 增加 VoxCPM2 synthesis 分支。

- `backend/engine/voxcpm2_adapter.py`
  - 新增文件。
  - 实现 tag 过滤/映射、phoneme 转换、style instruction、generate kwargs 构建。

- `backend/services/tts_pipeline_service.py`
  - 从 `payload.config.tts_backend` 决定本次后端。
  - 调用 `ensure_tts_ready(tts_backend=...)`。
  - 选择对应模型路径写入缓存/stale metadata。

- `backend/services/tts_scan_service.py`
  - 使用当前后端 resolved preset profile hash。
  - 确保 config hash 稳定。

- `backend/services/tts_stale_service.py`
  - 使用当前后端 resolved preset profile hash。
  - 保持 `tts_backend_changed` / `tts_model_changed` reason。

- `.env.example`
  - 新增 `BV_VOXCPM_TTS_MODEL_PATH=openbmb/VoxCPM2`。

- `backend/requirements.txt`
  - 增加 `voxcpm`，若官方包名不同，以实际安装包为准。

### 前端

- `frontend/src/components/synthesis/SynthesisConfigCard.jsx`
  - 改为 OmniVoice/VoxCPM2 tabs。
  - 后端 tab 决定 `config.tts_backend`。
  - 参数按后端分组展示。

- `frontend/src/components/settings/OrchestratorConfigCard.jsx`
  - `TTS 模型目录` 改名为 `OmniVoice TTS 模型目录`。
  - 新增 `VoxCPM2 TTS 模型目录`。

- `frontend/src/stores/useSynthesisStore.js`
  - 默认 config 增加 `tts_backend`、`omnivoice`、`voxcpm2`。
  - payload 原样提交扩展 config。

- `frontend/src/stores/useSettingsStore.js`
  - normalize/payload 增加 `voxcpm_tts_model_path`。

- `frontend/src/pages/VoiceConfigPage.jsx`
  - 第一阶段确保保存/读取 `backend_profiles` 不丢失。
  - 第二阶段增加 profile tabs。

## 8. 测试计划

### 后端单测

新增或扩展：

- `backend/tests/test_runtime_config.py`
  - 保存/加载 `voxcpm_tts_model_path`。
  - 旧 config 缺字段时默认 `openbmb/VoxCPM2`。

- `backend/tests/test_model_orchestrator.py`
  - `ensure_tts_ready(tts_backend="voxcpm2")` 使用 VoxCPM2 模型路径。
  - 后端、模型目录、设备变化时触发 reload。

- `backend/tests/test_tts_engine.py` 或新增 `test_voxcpm2_tts_engine.py`
  - fake `voxcpm.VoxCPM` 验证加载。
  - 验证 `generate()` kwargs：`cfg_value`、`inference_timesteps`、`normalize`、`denoise`、`reference_wav_path`、`prompt_wav_path`、`prompt_text`。

- `backend/tests/test_voxcpm2_adapter.py`
  - `[laughter] -> [laughing]`。
  - 保留 supported tags。
  - 删除 unsupported tags。
  - `朝CHAO2 -> {chao2}`。
  - 出现 `{...}` 时 `normalize=False`。
  - `speed/duration` 不进入 kwargs。

- `backend/tests/test_tts_stale_service.py`
  - 切换 `tts_backend` 后 stale reason 包含 `tts_backend_changed`。
  - 只修改 VoxCPM2 profile 不影响 OmniVoice preset hash。

### 前端单测

新增或扩展：

- `frontend/tests/synthesisStore.test.mjs`
  - 默认 config 包含 `tts_backend="omnivoice"`。
  - VoxCPM2 config 可以原样提交。

- `frontend/tests/settingsStore.test.mjs`
  - `voxcpm_tts_model_path` normalize 和 payload round-trip。

- 如果已有组件测试能力：
  - `SynthesisConfigCard` tab 切换会调用 `onSetConfig({ tts_backend: "voxcpm2" })`。
  - OmniVoice/VoxCPM2 参数分别更新正确嵌套字段。

### 手动验收流程

1. 启动后端和前端。
2. 打开系统设置：
   - 设置 OmniVoice TTS 模型目录。
   - 设置 VoxCPM2 TTS 模型目录为 `openbmb/VoxCPM2` 或本地路径。
   - 保存配置，刷新状态无错误。
3. 文本输入页使用快速解析（推荐）解析一小段文本。
4. 声音配置页：
   - 选择一个已有 preset。
   - 确认 OmniVoice profile 可用。
   - 配置或 fallback 出 VoxCPM2 profile。
5. 合成导出页：
   - 选择 `OmniVoice` tab，合成 1-2 段，确认可播放。
   - 切换 `VoxCPM2` tab，合成同样片段，确认可播放。
   - 检查 stale report 或 UI 状态，切换后端后旧音频应显示需要重生成。
6. 检查项目 JSON：
   - `synthesis_config.tts_backend` 保存为当前 tab。
   - segment asset 中 `source_tts_backend` 分别记录 `omnivoice` / `voxcpm2`。

## 9. 执行顺序建议

1. 后端数据模型与配置字段。
2. VoxCPM2 adapter 单测和实现。
3. `TTSEngine` VoxCPM2 加载与 fake model 单测。
4. pipeline/orchestrator 接入 `config.tts_backend`。
5. cache/stale resolved profile hash 修正。
6. 前端系统设置字段。
7. 前端合成参数 tabs。
8. 声音预设 backend profiles 的保存兼容。
9. 跑后端核心单测、前端单测、手动验收。

## 10. 验收标准

- 仓库中存在 `docs/voxcpm2-synthesis-support-plan.md`。
- 文档明确本轮范围：只做本地 Python VoxCPM2，不做 vLLM HTTP，不改 LLM 解析。
- 文档明确 UI 入口：
  - 系统设置新增 VoxCPM2 模型目录。
  - 合成导出页 tabs 决定本次 TTS 后端。
- 文档明确 VoxCPM2 adapter：
  - `[laughter] -> [laughing]`
  - 保留 VoxCPM2 支持 tag。
  - 删除不支持 tag。
  - `汉字PINYIN1` 转 `{pinyin1}`。
  - 出现 `{...}` phoneme 时 `normalize=False`。
- 文档明确合成参数映射：
  - OmniVoice：`num_step/guidance_scale/denoise`
  - VoxCPM2：`inference_timesteps/cfg_value/denoise/normalize`
- 文档包含文件级修改建议，可交给实现者直接执行。
