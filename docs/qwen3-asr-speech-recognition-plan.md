# Qwen3-ASR GGUF 语音识别与说话人标签执行计划

## Summary
- 新增独立“语音识别”Tab，放在左侧导航“文本输入”之前。
- 语音识别支持录音、上传音频、选择 `Qwen3-ASR GGUF` 或 `Whisper` 后端。
- 系统配置新增 `Qwen3-ASR GGUF 模型目录`，后端自动发现主模型、`mmproj_model`、`aligner_model`。
- 支持“带说话人标签转录”；仅依赖 ASR 模型输出，不引入额外 diarization 模型。

## Implementation Changes

### 1. 配置与模型发现
- 在 `OrchestratorConfig`、`OrchestratorConfigPayload`、前端 settings store 中新增：
  - `qwen3_asr_gguf_model_dir: string`
- 系统配置页新增输入项：`Qwen3-ASR GGUF 模型目录`。
- 后端新增目录扫描逻辑：
  - 主模型：目录下 `*.gguf`，排除 `mmproj*`、`*aligner*`、`*forced*`
  - mmproj：优先 `mmproj*.gguf`
  - aligner：优先 `*forced*aligner*.gguf` 或 `*aligner*.gguf`
- `GET /api/v1/system/status` 返回 Qwen3-ASR 发现结果：
  - `qwen3_asr_main_model_path`
  - `qwen3_asr_mmproj_model_path`
  - `qwen3_asr_aligner_model_path`
  - `qwen3_asr_available`
  - `qwen3_asr_warnings`

### 2. 后端 ASR API
- 新增 `backend/api/asr_routes.py`，并挂载到主 router。
- 新增接口：`POST /api/v1/asr/transcribe-file`
  - multipart 字段：
    - `file`: 音频文件
    - `backend`: `qwen3_asr | whisper`
    - `speaker_labels`: `true | false`
  - 返回：
    - `text`: 普通转写文本
    - `labeled_text`: 带说话人标签文本
    - `backend`: 实际后端
    - `speaker_labels`: 是否启用标签
    - `model_files`: Qwen3-ASR 模型发现信息
    - `alignments`: aligner 可用时返回，否则为空数组
    - `warnings`: 非阻断提示
- 上传音频写入后端临时目录，处理完成后清理。

### 3. ASR Engine 扩展
- 保留现有 Whisper / faster-whisper 逻辑。
- 增加 `transcribe(audio_path, backend="whisper", speaker_labels=False)` 调度入口。
- `backend="whisper"`：
  - 复用现有 Whisper 转写。
  - `speaker_labels=true` 时输出单说话人格式：`说话人1：{text}`，并返回 warning 表明 Whisper 不做真实说话人分离。
- `backend="qwen3_asr"`：
  - 使用 `llama-cpp-python` 的 `Llama` + `MTMDChatHandler`。
  - 必须同时存在主模型和 mmproj；缺少任一项直接返回清晰错误。
  - `speaker_labels=false` 时提示模型只输出纯转写文本。
  - `speaker_labels=true` 时提示模型按 `说话人1：...`、`说话人2：...` 格式分段输出。
- 对模型输出做规范化：
  - 支持解析 `说话人1：`、`Speaker 1:`、`SPEAKER_01:`。
  - 统一输出中文全角冒号格式。
  - 未识别出多说话人时降级为 `说话人1：全文`，并返回 warning。
- ForcedAligner 仅走 GGUF 路线：
  - v1 只发现 `aligner_model` 并在状态中展示。
  - 若没有明确可用的 GGUF aligner runner，不伪造时间戳，只返回 warning。

### 4. 前端导航与页面
- 左侧导航顺序改为：
  - 语音识别
  - 文本输入
  - 剧本编辑
  - 声音配置
  - 合成导出
- 新增 `SpeechRecognitionPage.jsx`。
- 页面控件：
  - 后端选择：`Qwen3-ASR GGUF`、`Whisper`
  - 说话人标签开关
  - 上传音频按钮
  - 开始录音 / 停止录音按钮
  - 识别状态与错误展示
  - 转写预览文本框
  - `追加到文本输入`
  - `替换文本输入`
  - `清空结果`
- 录音使用浏览器 `MediaRecorder`。
- 接入文本输入：
  - `追加到文本输入`：在现有 `sourceText` 后追加空行和识别结果。
  - `替换文本输入`：用识别结果覆盖 `sourceText`。
  - 成功后 toast 提示，并提供跳转到“文本输入”。

### 5. UI 状态与错误
- Qwen3-ASR 未配置目录时，选择该后端并开始识别应显示明确错误。
- Qwen3-ASR 缺少 mmproj 时，错误文案提示用户检查模型目录。
- 录音权限被拒绝时显示浏览器权限提示。
- 识别结果为空时不修改文本输入，显示 warning。
- Whisper 后端可在未配置 Qwen3-ASR 时继续可用。

## Test Plan
- 后端单元测试：
  - Qwen3-ASR 目录扫描识别主模型、mmproj、aligner。
  - 缺少主模型或 mmproj 时返回明确错误。
  - Whisper 分支保持兼容。
  - `speaker_labels=true` 时标签规范化正确。
  - 未识别多说话人时降级为 `说话人1：全文`。
- 后端 API 测试：
  - multipart 上传调用 fake ASR engine。
  - `backend=whisper` 和 `backend=qwen3_asr` 均覆盖。
  - warning 不阻断正常转写。
- 前端测试：
  - 侧边栏顺序正确，“语音识别”在“文本输入”之前。
  - 后端选择和说话人标签开关正确传参。
  - 预览不会自动修改 `sourceText`。
  - 追加/替换行为正确更新文本输入 store。
- 手工验收：
  - Whisper 上传音频可转写。
  - Whisper 录音可转写。
  - Qwen3-ASR 配置目录后可转写。
  - 开启说话人标签后，结果能以 `说话人1：文本` 格式接入文本输入。

## Assumptions
- v1 做单次离线识别，不做实时流式字幕。
- 说话人分离仅依赖 ASR 模型提示和输出解析，不新增独立 diarization 依赖。
- Qwen3-ASR GGUF 模型目录内文件命名遵循常见 GGUF 命名习惯。
- ForcedAligner v1 只做 GGUF 模型发现与状态展示，不实现不可靠的伪时间戳。
