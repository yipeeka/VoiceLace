# VoiceLace
### 本地多角色有声书工作台 / Local multi-role audiobook studio

语音识别、字幕导入、文本解析、剧本编辑、角色配音、音乐生成、局部重生成与工程导入导出，全都在你的电脑上完成。  
Speech recognition, subtitle import, script parsing, script editing, voice casting, music generation, partial regeneration, and project import/export all run on your own machine.

默认优先本地运行：`llama-cpp-python` / `OmniVoice` / `VoxCPM2` / `Whisper` / `Qwen3-ASR` / `ACE-Step`，不依赖云端 API。  
Local-first by default with `llama-cpp-python`, `OmniVoice`, `VoxCPM2`, `Whisper`, `Qwen3-ASR`, and `ACE-Step`, with cloud APIs optional.

> [!WARNING]
> 项目仍在快速迭代中，建议先按“源码启动”跑通，再切换自己的本地模型和声音预设。  
> This project is moving quickly. Run the source workflow first, then switch to your own local models and voice presets.
>
> 目前仅在 Windows 上完成测试。  
> This project has only been tested on Windows so far.

## Features / 功能

| Feature / 功能 | What it does / 说明 |
|---|---|
| Speech Recognition / 语音识别 | Upload audio, transcribe with `Whisper` or `Qwen3-ASR (CrispASR)`, review text, and create a dubbing project directly. 上传音频，用 `Whisper` 或 `Qwen3-ASR (CrispASR)` 转写、校对，并直接创建配音项目。 |
| Subtitle Workflow / 字幕工作流 | Preview subtitles, translate subtitle content, keep timeline cues, and create timeline-based dubbing projects. 预览字幕、翻译字幕、保留时间轴，并创建时间轴配音项目。 |
| Local LLM Script Parsing / 本地 LLM 剧本解析 | Parse long text into speakers, narration, dialogue, emotion, and TTS-ready segments with `llama_cpp`, OpenAI, Gemini, or mock mode. 使用 `llama_cpp`、OpenAI、Gemini 或 mock 模式，把长文本解析为角色、旁白、对白、情绪和 TTS 片段。 |
| Parse QC / 解析质检 | Inspect parsed structure before production and catch speaker/segment issues early. 在进入制作前检查解析结构，尽早发现说话人和分段问题。 |
| Script Editor / 剧本编辑 | Edit segments, insert/delete lines, adjust speaker/type/text/emotion/TTS overrides, and save as project data. 编辑片段、增删行、调整角色/类型/文本/情绪/TTS 覆盖项，并保存为项目数据。 |
| Voice Profiles / 声音配置 | Create, preview, sort, and bind character voices for narration, dialogue, and voice cloning workflows. 创建、试听、排序和绑定角色声音，支持旁白、对白和声音克隆流程。 |
| TTS Synthesis / 语音合成 | Generate full projects or only changed segments with OmniVoice / VoxCPM2 backend selection, waveform previews, and generated subtitles. 使用 OmniVoice / VoxCPM2 全量合成或仅重生成改动片段，支持波形预览和字幕生成。 |
| Segment Review / 逐段对照修改 | Compare generated audio against each script segment, revise text or voice settings, and regenerate only affected segments. 对照每段生成音频修改剧本文本或声音配置，并只重生成受影响片段。 |
| Music Generation / 音乐生成 | Generate or upload music assets with local ACE-Step Diffusers models, use the AI music assistant, and bind tracks as `BGM` or `Ambience`. 使用本地 ACE-Step Diffusers 生成或上传音乐素材，通过 AI 音乐助手生成表单，并绑定为 `BGM` 或 `Ambience`。 |
| Realtime Tasks / 实时任务 | Track LLM, ASR, TTS, and music jobs through WebSocket progress, cancellation, and event replay. 通过 WebSocket 跟踪 LLM、ASR、TTS 和音乐任务进度，支持取消和事件回放。 |
| Project Management / 工程管理 | Import/export project files or archives, rename projects, clean duplicates, and keep runtime data local. 导入/导出项目文件或压缩包，重命名项目、清理重复项，并将运行时数据保存在本地。 |

---

## Quickstart / 快速开始

### 1. Install dependencies / 安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd frontend
npm install
cd ..
```

Notes / 说明：
- `backend/requirements.txt` points `llama-cpp-python` to [JamePeng/llama-cpp-python](https://github.com/JamePeng/llama-cpp-python).  
  `backend/requirements.txt` 中的 `llama-cpp-python` 已指向 [JamePeng/llama-cpp-python](https://github.com/JamePeng/llama-cpp-python)。
- Dependencies have been merged into one file; there is no separate real-model requirements file anymore.  
  依赖已合并为一个文件，不再区分基础依赖和真实模型依赖。
- ACE-Step music generation requires `diffusers==0.38.0` and `safetensors==0.8.0rc0`, both included in `backend/requirements.txt`.  
  ACE-Step 音乐生成需要 `diffusers==0.38.0` 和 `safetensors==0.8.0rc0`，二者已写入 `backend/requirements.txt`。
- `ffmpeg` is recommended for audio/video workflows.  
  音频/视频相关流程建议额外安装 `ffmpeg`。

### 2. Configure models / 配置模型

Check these items in Settings or `.env` / 请在系统设置页或 `.env` 中确认：

- `LLM Backend / LLM 后端`: `llama_cpp`
- `LLM Model Path / LLM 模型路径`: local GGUF model path / 本地 GGUF 模型路径
- `TTS Model Directory / TTS 模型目录`: OmniVoice model directory / OmniVoice 模型目录
- `ASR Model Path / ASR 模型路径`: choose by backend / 按识别后端填写
- `Qwen3-ASR (CrispASR)`: install CrispASR first and configure its executable path / 使用前需先安装 CrispASR，并填写 CrispASR 可执行文件路径
- `Music Generation / 音乐生成`: enable it and configure ACE-Step Turbo/Base Diffusers model directories / 如需使用，请开启并配置 ACE-Step Turbo/Base Diffusers 模型目录

Starter config / 推荐起步配置：

```env
BV_LLM_BACKEND=llama_cpp
BV_LLM_MODEL_PATH=.\models\Qwen3.5-9B-UD-Q4_K_XL.gguf
BV_LLM_CHAT_FORMAT=chatml
BV_LLM_N_CTX=8192
BV_LLM_N_GPU_LAYERS=-1

BV_TTS_MODEL_PATH=.\models\OmniVoice
BV_TTS_DEVICE=cuda:0

BV_ASR_MODEL_PATH=base
BV_ASR_DEVICE=cuda:0

BV_MUSIC_ENABLED=false
BV_MUSIC_MODEL_VARIANT=turbo
BV_MUSIC_TURBO_MODEL_DIR=.\models\ACE-Step\acestep-v15-xl-turbo-diffusers
BV_MUSIC_BASE_MODEL_DIR=.\models\ACE-Step\acestep-v15-xl-base-diffusers
BV_MUSIC_DEVICE_MODE=cpu_offload
```

For higher quality, switch to / 如果更看重效果，可以换成：

```env
BV_LLM_MODEL_PATH=.\models\Qwen3.5-27B-UD-IQ3_XXS.gguf
```

### 3. Start / 启动

Recommended on Windows / Windows 推荐：

```powershell
.\run.bat
```

Equivalent command / 等价命令：

```powershell
.\.venv\Scripts\python.exe start.py
```

Default URLs / 默认地址：
- Frontend / 前端：`http://127.0.0.1:5173`
- Backend / 后端：`http://127.0.0.1:8000`

Run separately / 分开启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

```powershell
cd frontend
npm run dev
```

### 4. Workflow / 页面顺序

1. **Speech Recognition / 语音识别**：upload audio or subtitles, transcribe/translate, and create a dubbing project / 上传音频或字幕，转写/翻译后创建配音项目
2. **Text Input / 文本输入**：create a project from pasted text and parse it / 也可以粘贴文本新建项目并解析
3. **Parse QC / 解析质检**：review structure before editing / 检查 LLM 拆分结构
4. **Script Editor / 剧本编辑**：edit speakers, segments, emotion, and TTS overrides / 编辑分段、说话人、情绪和 TTS 覆盖项
5. **Voice Profiles / 声音配置**：bind voices to characters / 给角色绑定声音预设
6. **Music Generation / 音乐生成**：generate or upload music and bind it as `BGM` / `Ambience` / 生成或上传音乐素材，并绑定为 `BGM` / `Ambience`
7. **Synthesis Export / 合成导出**：full synthesis first, then regenerate changed segments / 先全量合成，之后只重生成改动段落
8. **Export / 工程导出**：export project files or ZIP archives / 按需导出项目文件或 ZIP

---

## Recommended Models / 推荐模型

| Model / 模型 | Best for / 推荐场景 | Notes / 说明 |
|---|---|---|
| `Qwen3.5-27B-UD-IQ3_XXS.gguf` | Quality-first setups with more memory/VRAM / 追求效果、内存或显存更充足 | Better for complex text and higher quality parsing / 更适合复杂文本和更高质量解析 |
| `Qwen3.5-9B-UD-Q4_K_XL.gguf` | Daily use on most machines / 大多数机器的日常使用 | Better balance of speed and quality / 速度和效果更均衡 |

Suggestions / 建议：
- Use both models through the `llama_cpp` backend. / 两个模型都按 `llama_cpp` 后端使用。
- Use either absolute paths or repository-relative paths for model files. / 模型文件既可以放在任意位置并填写绝对路径，也可以直接使用仓库相对路径。
- If Settings asks for `clip_model_path`, configure `LLM CLIP Model Path`. / 如果系统设置提示需要 `clip_model_path`，请补上 `LLM CLIP 模型路径`。

---

## TTS Backend Guide / TTS 后端选择

| Backend / 后端 | Strengths / 优势 | Best for / 适合场景 |
|---|---|---|
| `OmniVoice` | Fast dubbing, broad multilingual support, strong cold-language coverage, and tag-style controls for age, pitch, dialect, and non-verbal cues. 快速配音、多语言和冷门语言覆盖强，支持用年龄、音调、方言、非语言标签等指令批量控制声音。 | Realtime dubbing, AI customer service, live translation, digital human dialogue, and multilingual or mixed-language input. 实时配音、AI 客服、实时翻译、数字人对话，以及多语种或混合语种输入。 |
| `VoxCPM2` | Audiobook-oriented quality, more natural expression, high-fidelity output, and natural-language voice design. 更偏有声书质量，强调自然表现力、高音质，以及用自然语言描述虚拟人声。 | Audiobooks, high-quality voice cloning, film/TV post-production, studio-grade narration, and premium content creation. 有声书、高质量语音克隆、影视后期、录音棚级旁白和高端内容创作。 |

Choose `OmniVoice` if / 选择 `OmniVoice` 如果：
- You need uncommon languages or mixed multilingual input. / 你需要处理冷门语言或多语种混合输入。
- Your scenario is extremely latency-sensitive, such as AI customer service, realtime translation, or digital human dialogue. / 你的应用场景对延迟极其敏感，如 AI 客服、实时翻译、数字人对话。
- You want batch voice generation through tag-style instructions like age, pitch, or dialect. / 你希望通过年龄、音调、方言等标签化指令来批量生成声音。

Choose `VoxCPM2` if / 选择 `VoxCPM2` 如果：
- You want studio-grade sound quality and very natural expressiveness. / 你追求录音棚级音质和极其自然的表现力。
- You need high-quality voice cloning for audiobooks, film/TV post-production, or premium content. / 你需要用于有声书、影视后期或高端内容创作的高质量语音克隆。
- You prefer natural-language voice design for unique virtual voices, similar to Vibe Coding. / 你更喜欢用自然语言描述来创造独一无二的虚拟人声，类似 Vibe Coding 风格。

summary / 总结：
- `OmniVoice`: fast, multilingual, better for dubbing, realtime use, and instruction/tag-based batch voice creation. / `OmniVoice`：快速、多语言，更适合配音、实时场景和标签化批量声音生成。
- `VoxCPM2`: higher fidelity, more natural, better for audiobooks, voice cloning, and premium production. / `VoxCPM2`：音质更高、更自然，更适合有声书、语音克隆和高端内容制作。

---

## Configuration / 安装与配置

### `.env` example / `.env` 常用项

See [`.env.example`](./.env.example). / 参考 [`.env.example`](./.env.example)。

```env
BV_LLM_BACKEND=llama_cpp
BV_LLM_MODEL_PATH=D:\path\to\model.gguf
BV_LLM_API_MODEL=gpt-4.1-mini
BV_LLM_CHAT_FORMAT=chatml
BV_LLM_N_CTX=8192
BV_LLM_N_GPU_LAYERS=-1
BV_LLM_THREADS=0
BV_LLM_TEMPERATURE=0.2
BV_LLM_TOP_P=0.9
BV_LLM_TOP_K=40
BV_LLM_MIN_P=0.0
BV_LLM_PRESENCE_PENALTY=0.0
BV_LLM_REPEAT_PENALTY=1.0
BV_LLM_MAX_TOKENS=2048
BV_ENABLE_LLAMA_CPP_THINK_MODE=true

BV_SECONDARY_LLM_MODEL_PATH=
BV_SECONDARY_LLM_CLIP_MODEL_PATH=
BV_SECONDARY_LLM_N_CTX=4096
BV_SECONDARY_LLM_N_GPU_LAYERS=-1
BV_SECONDARY_LLM_THREADS=0
BV_SECONDARY_LLM_TEMPERATURE=0.2
BV_SECONDARY_LLM_TOP_P=0.9
BV_SECONDARY_LLM_TOP_K=40
BV_SECONDARY_LLM_MIN_P=0.0
BV_SECONDARY_LLM_PRESENCE_PENALTY=0.0
BV_SECONDARY_LLM_REPEAT_PENALTY=1.0
BV_SECONDARY_LLM_MAX_TOKENS=1024
BV_SECONDARY_ENABLE_LLAMA_CPP_THINK_MODE=false

BV_TTS_MODEL_PATH=.\models\OmniVoice
BV_VOXCPM_TTS_MODEL_PATH=openbmb/VoxCPM2
BV_TTS_DEVICE=cuda:0

BV_MUSIC_ENABLED=false
BV_MUSIC_MODEL_DIR=
BV_MUSIC_TURBO_MODEL_DIR=
BV_MUSIC_BASE_MODEL_DIR=
BV_MUSIC_MODEL_VARIANT=turbo
BV_MUSIC_DEVICE_MODE=cpu_offload

BV_ASR_BACKEND=whisper
BV_ASR_MODEL_PATH=base
BV_ASR_DEVICE=cuda:0
BV_QWEN3_ASR_CRISPASR_EXE=
BV_QWEN3_ASR_MODEL_PATH=
BV_QWEN3_ASR_FORCED_ALIGNER_MODEL_PATH=
BV_QWEN3_ASR_THREADS=0
BV_QWEN3_ASR_LANGUAGE=auto
BV_QWEN3_ASR_ENABLE_TIMESTAMPS=false

BV_PYANNOTE_MODEL_ID=pyannote/speaker-diarization-community-1
BV_PYANNOTE_AUTH_TOKEN=
BV_PYANNOTE_DEVICE=cuda:0

BV_AUTO_SERIAL=true
BV_AUTO_UNLOAD_LLM_AFTER_PARSE=false
BV_AUTO_LOAD_TTS_BEFORE_SYNTH=true
BV_DEBUG_STALE_REPORT=false
BV_ALLOW_MOCK_FALLBACK=true

BV_MCP_ENABLED=false
BV_MCP_MOUNT_PATH=/mcp
```

Notes / 说明：
- `BV_ALLOW_MOCK_FALLBACK=false` makes model loading failures fail fast. / `BV_ALLOW_MOCK_FALLBACK=false` 时，模型加载失败会直接报错。
- If `backend/data/config.json` exists, runtime settings from the UI take priority. / 如果存在 `backend/data/config.json`，运行时会优先读取系统设置页保存的配置。
- `.env` is best for startup defaults and secrets; Settings is better for daily tuning. / `.env` 更适合启动默认值和敏感信息，系统设置页更适合日常调整。

### MCP server / MCP 服务端

VoiceLace can expose a local MCP (Model Context Protocol) server for AI clients. It is disabled by default. / VoiceLace 可以作为本地 MCP（Model Context Protocol）服务端暴露给 AI 客户端，默认关闭。

```env
BV_MCP_ENABLED=false
BV_MCP_MOUNT_PATH=/mcp
```

After enabling and restarting the backend, connect MCP clients to `http://127.0.0.1:8000/mcp`. The server exposes project inspection plus transcription, parsing, synthesis, music, postprocess, export, task polling, and cancellation tools. Destructive maintenance operations are not exposed. / 开启并重启后端后，MCP 客户端连接 `http://127.0.0.1:8000/mcp`。服务端会暴露项目查看、转写、解析、合成、音乐、后处理、导出、任务查询和取消工具；不会暴露破坏性维护操作。

### Data directory / 数据位置

Runtime data lives under `backend/data`. / 运行时数据默认位于 `backend/data`：

- `config.json`: runtime config / 运行时配置
- `projects/`: project data / 项目数据
- `voices/`: voice presets and reference audio / 声音预设和参考音频
- `output/`: synthesis outputs and exports / 合成产物与导出文件
- `output/music/`: generated music and asset library / 音乐生成结果和音乐素材库
- `cache/tts/`: rebuildable TTS cache / 可重建 TTS 缓存

---

## Usage / 使用说明

### Speech Recognition / 语音识别

- The default entry page supports audio upload with `Whisper` or `Qwen3-ASR (CrispASR)`. / 默认入口页支持上传音频，并选择 `Whisper` 或 `Qwen3-ASR (CrispASR)`。
- Supports transcription, timeline display, speaker labels, and text proofreading. / 支持普通转写、时间轴显示、说话人标签和文本校对。
- Recognition results can create dubbing projects directly. / 可从识别结果直接创建配音项目。
- Subtitle tools support preview, translation, and timeline-based project creation. / 字幕工具支持字幕预览、字幕翻译，并可创建时间轴配音项目。
- `Qwen3-ASR (CrispASR)` requires CrispASR installed and `BV_QWEN3_ASR_CRISPASR_EXE` configured. / 使用 `Qwen3-ASR (CrispASR)` 前，需要先安装 CrispASR，并配置 `BV_QWEN3_ASR_CRISPASR_EXE`。

### Text Input / 文本输入

- Switch, create, rename, open, and import projects. / 支持项目切换、新建、改名、打开项目文件和导入工程 ZIP。
- `Two-step parsing` is recommended for long or complex text. / `两步解析` 更稳，适合长文本和复杂对话。
- `Classic single-pass parsing` is faster and keeps legacy behavior. / `经典单步解析` 更快，兼容旧行为。
- Custom prompts mainly affect the single-pass path. / 自定义提示词主要影响单步链路。

### Script Editor / 剧本编辑

- Edit `speaker/type/text/emotion/tts_overrides` per segment. / 可逐段编辑 `speaker/type/text/emotion/tts_overrides`。
- Insert new segments at specific positions. / 新增片段可插入指定位置。
- Changes stay in draft state until saved. / 所有改动都会先进入草稿态，保存后才写入项目。

### Voice Profiles / 声音配置

- Character assignments are grouped by real speakers in the script. / 角色分配会按剧本真实说话人聚合。
- Create, preview, bind, and sort voice presets. / 支持声音预设创建、试听、绑定与排序。
- Designed for multi-character narration and dialogue. / 适合多角色、旁白和对白混合场景。

### Music Generation / 音乐生成

- Enable Music Generation in Settings and configure ACE-Step Turbo or Base Diffusers model directories. / 先在系统设置开启音乐生成，并配置 ACE-Step Turbo 或 Base Diffusers 模型目录。
- `text2music` is for prompt-based background music; `cover` / `repaint` can reuse asset-library audio. / `text2music` 适合提示词生成背景音乐，`cover` / `repaint` 可复用素材库音频。
- The AI music assistant can create music form suggestions from the current project text. / AI 音乐助手可根据当前项目文本生成音乐表单建议。
- Generated tracks enter the music asset library and can be bound as `BGM` or `Ambience`. / 生成结果会进入音乐素材库，可绑定为当前项目的 `BGM` 或 `Ambience`。

### Synthesis Export / 合成导出

- Segment status shows synced, missing audio, and needs-regeneration states. / 每段会显示同步、缺失音频和待重生成状态。
- Supports single-segment and batch regeneration. / 支持单段重生成和批量重生成。
- Full audio and segment audio both support waveform preview. / 完整音频与分段音频都支持波形显示。
- Full synthesis also generates subtitle assets, keeping audio, subtitles, and waveform data aligned. / 全量合成会同步生成字幕资产，让音频、字幕和波形数据保持一致。
- You can compare generated audio segment by segment, adjust script text or voice settings, and regenerate only the affected segments. / 可以对照每段生成音频逐段修改剧本文本或声音配置，并只重生成受影响片段。
- Bound `BGM` / `Ambience` assets are used in the post-processing area. / 若项目绑定了 `BGM` / `Ambience`，合成导出页会在后处理区域使用这些素材。

### TTS Assets / TTS 资产

- Full synthesis rebuilds complete audio, subtitles, and waveforms for the current `tts_backend`. / 全量合成会按当前 `tts_backend` 重建整本音频、字幕和波形。
- Partial regeneration targets `segment_ids`; with `rebuild_full=false`, only selected segments are updated. / 局部重生成通过 `segment_ids` 定位片段，`rebuild_full=false` 时只更新目标片段。
- If you switch engines, run a full synthesis again for consistent assets. / 如果切换过不同引擎，建议再做一次全量合成来保持资产一致。

---

## Troubleshooting / 故障排查

### 1. Parse falls back to mock / 解析失败后回退到 mock

Check system status / 先检查系统状态：

```powershell
curl "http://127.0.0.1:8000/api/v1/system/status"
```

Verify / 重点确认：
- `llm_backend`
- `llama_cpp_available`
- model path exists / 模型路径是否存在
- API key or model name is correct / API Key 或模型名是否正确

### 2. Qwen3.5 model fails to load / Qwen3.5 模型加载报错

- Make sure backend is `llama_cpp`. / 确认使用的是 `llama_cpp` 后端。
- Make sure the GGUF path exists. / 确认 GGUF 路径存在。
- If `Qwen35ChatHandler` asks for `clip_model_path`, configure `LLM CLIP Model Path`. / 如果提示 `Qwen35ChatHandler` 需要 `clip_model_path`，请在系统设置里补 `LLM CLIP 模型路径`。

### 3. ASR unavailable / ASR 不可用

- Check `BV_ASR_BACKEND`, `BV_ASR_MODEL_PATH`, and device settings. / 检查 `BV_ASR_BACKEND`、`BV_ASR_MODEL_PATH` 和设备配置。
- For `qwen3_crispasr`, install CrispASR and verify `BV_QWEN3_ASR_CRISPASR_EXE` plus `BV_QWEN3_ASR_MODEL_PATH`. / 使用 `qwen3_crispasr` 时，确认系统已安装 CrispASR，且 `BV_QWEN3_ASR_CRISPASR_EXE` 与 `BV_QWEN3_ASR_MODEL_PATH` 都存在。
- For speaker labels, verify `BV_PYANNOTE_AUTH_TOKEN` and model access. / 需要说话人标签时，确认 `BV_PYANNOTE_AUTH_TOKEN` 和 Pyannote 模型权限。

### 4. Music generation unavailable / 音乐生成不可用

- Set `BV_MUSIC_ENABLED=true`. / 确认 `BV_MUSIC_ENABLED=true`。
- Use `turbo` or `base` for `BV_MUSIC_MODEL_VARIANT`. / 确认 `BV_MUSIC_MODEL_VARIANT` 是 `turbo` 或 `base`。
- Configure `BV_MUSIC_TURBO_MODEL_DIR` or `BV_MUSIC_BASE_MODEL_DIR`. / 确认对应模型目录已配置。
- For limited VRAM, prefer `BV_MUSIC_DEVICE_MODE=cpu_offload`. / 如果显存紧张，优先使用 `BV_MUSIC_DEVICE_MODE=cpu_offload`。

### 5. Waveform issues / 波形异常

- Confirm audio URLs/files are accessible. / 先确认音频文件可访问。
- Refresh and retry. / 刷新页面后重试。
- Playback usually remains available even if waveform rendering degrades. / 如果完整音频可播但波形异常，播放能力通常仍会保留。

---

## FAQ / 常见问题

### Does this project require internet? / 这个项目一定要联网才能用吗？

Not necessarily. The core workflow can run locally with GGUF LLMs, OmniVoice / VoxCPM2, Whisper or Qwen3-ASR, and local ACE-Step Diffusers models. Network access is only needed for OpenAI, Gemini, restricted Hugging Face models, or first-time model downloads.  
不一定。核心工作流可以本地运行：LLM 用 GGUF，TTS 用 OmniVoice / VoxCPM2，ASR 用 Whisper 或 Qwen3-ASR，音乐生成用本地 ACE-Step Diffusers 模型。只有使用 OpenAI、Gemini、Hugging Face 权限模型或首次下载模型时才需要网络。

### Which llama-cpp-python is used? / llama-cpp-python 用哪个版本？

This project uses [JamePeng/llama-cpp-python](https://github.com/JamePeng/llama-cpp-python), already configured in `backend/requirements.txt`.  
本项目使用 [JamePeng/llama-cpp-python](https://github.com/JamePeng/llama-cpp-python)，已在 `backend/requirements.txt` 中配置。

### Which LLM model should I choose? / 推荐哪个 LLM 模型？

Use `Qwen3.5-9B-UD-Q4_K_XL.gguf` for daily use and easier startup. Use `Qwen3.5-27B-UD-IQ3_XXS.gguf` when you have more resources and want better parsing quality.  
日常优先用 `Qwen3.5-9B-UD-Q4_K_XL.gguf`，更容易跑起来。机器资源更充足时用 `Qwen3.5-27B-UD-IQ3_XXS.gguf`，复杂文本解析效果更好。

### Can I try it without real models? / 没有真实模型能先试用吗？

Yes. Keep `BV_ALLOW_MOCK_FALLBACK=true`; failed model loads will fall back to mock mode, which is useful for checking UI, project management, and basic interactions.  
可以。保留 `BV_ALLOW_MOCK_FALLBACK=true`，模型加载失败时会回退到 mock 流程，适合检查 UI、项目管理和基础交互。

### How are Speech Recognition and Text Input related? / 语音识别和文本输入是什么关系？

Speech Recognition creates dubbing projects from audio or subtitles. Text Input creates projects from novels, scripts, or dialogue text. Both paths continue into Parse QC, Script Editor, Voice Profiles, and Synthesis Export.  
语音识别页可以从音频或字幕直接创建配音项目；文本输入页适合从小说、剧本、对白文本创建项目。两条入口创建出的项目都会进入解析质检、剧本编辑、声音配置和合成导出流程。

### Qwen3-ASR or Whisper? / Qwen3-ASR 和 Whisper 怎么选？

Whisper is the safer default. Qwen3-ASR is useful when you have installed CrispASR and prepared both the CrispASR executable path and GGUF model. In this project, Qwen3-ASR is mainly used as a recognition flow; timeline and speaker behavior follow the UI hints.  
Whisper 更适合作为默认起步方案；Qwen3-ASR 适合你已经安装 CrispASR，并准备好 CrispASR 可执行文件路径和 GGUF 模型时使用。当前 Qwen3-ASR 在项目中偏纯识别流程，时间轴和说话人能力以页面提示为准。

### Why is Music Generation disabled by default? / 音乐生成为什么默认关闭？

Music generation depends on local ACE-Step Diffusers models, which are large and need more memory/VRAM. Configure the model directory, set `BV_MUSIC_ENABLED=true`, then choose `turbo` or `base`.  
音乐生成依赖本地 ACE-Step Diffusers 模型，模型体积和显存/内存需求更高。确认模型目录后，把 `BV_MUSIC_ENABLED=true`，再选择 `turbo` 或 `base` 模型变体。

### Where are projects and audio saved? / 生成的项目和音频保存在哪里？

Runtime data is stored in `backend/data`: projects in `backend/data/projects`, voice presets in `backend/data/voices`, synthesis outputs in `backend/data/output`, and music assets in `backend/data/output/music`.  
运行时数据在 `backend/data`。项目在 `backend/data/projects`，声音预设在 `backend/data/voices`，合成产物在 `backend/data/output`，音乐素材在 `backend/data/output/music`。

---

## Command Reference / 启动命令速查

```powershell
.\run.bat
```

```powershell
.\.venv\Scripts\python.exe start.py
```

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

```powershell
cd frontend
npm run dev
```
