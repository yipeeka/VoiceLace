# BeautyVoiceTTS

本项目是一个本地运行的多角色有声书系统，主流程为：

1. 文本输入并调用 LLM 解析为剧本片段
2. 剧本编辑与角色声音分配
3. 调用 TTS 批量合成并导出音频

当前版本已支持真实模型后端，并具备 WebSocket 实时事件、任务取消、事件日志回放能力。

## 当前状态

- Backend: FastAPI
- Frontend: Vite + React
- LLM: `llama-cpp-python`（可回退 mock）
- TTS: `omnivoice`（可回退 mock）
- ASR: Whisper（`openai-whisper` / `faster-whisper`）
- 实时能力: WebSocket 任务流（LLM chunk、TTS segment/progress）
- 持久化: JSON（项目）+ JSONL（项目任务事件日志）

运行时配置策略：
- 设置页配置保存到 `backend/data/config.json`
- `.env` 仅用于启动默认值和敏感项（如 API Key）
- 设置页修改不会自动改写 `.env`

## 快速启动

### 1) 创建并激活虚拟环境

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2) 安装依赖

基础依赖：

```powershell
pip install -r backend\requirements.txt
cd frontend
npm install
cd ..
```

真实模型依赖（LLM/TTS/ASR）：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-real.txt
```

### 3) 配置 `.env`

参考 [`.env.example`](/E:/softs/BeautyVoiceTTS/.env.example)，常用项如下：

```env
BV_LLM_MODEL_PATH=D:\path\to\model.gguf
BV_LLM_BACKEND=llama_cpp
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
BV_OPENAI_API_KEY=your-openai-key
BV_OPENAI_MODEL=gpt-4.1-mini
BV_GEMINI_API_KEY=your-gemini-key
BV_GEMINI_MODEL=gemini-2.5-flash
BV_AUTO_SERIAL=true
BV_AUTO_UNLOAD_LLM_AFTER_PARSE=true
BV_AUTO_LOAD_TTS_BEFORE_SYNTH=true

BV_TTS_MODEL_PATH=E:\softs\BeautyVoiceTTS\models\OmniVoice
BV_TTS_DEVICE=cuda:0

BV_ASR_MODEL_PATH=base
BV_ASR_DEVICE=cuda:0

BV_ALLOW_MOCK_FALLBACK=true
```

说明：

- `BV_LLM_BACKEND` 支持 `llama_cpp` / `openai` / `gemini` / `mock`
- `BV_ASR_MODEL_PATH`
  - `openai-whisper` 模式可用 `tiny/base/small/...`
  - `faster-whisper` 模式可用模型名或本地目录
- `BV_ALLOW_MOCK_FALLBACK=false` 时，LLM/TTS 加载失败将直接报错，不回退 mock
- 如果 `backend/data/config.json` 存在，运行时会优先读取该文件中的配置

### 4) 启动项目

```powershell
.\.venv\Scripts\python.exe start.py
```

或分别启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

```powershell
cd frontend
npm run dev
```

## 关键接口

Base URL: `http://localhost:8000/api/v1`

- 系统状态：`GET /system/status`
- 工程导入：`POST /projects/import/archive`
- LLM 解析任务：`POST /llm/parse`，查询：`GET /llm/parse/{task_id}`
- LLM 取消：`POST /llm/parse/{task_id}/cancel`
- TTS 合成任务：`POST /tts/synthesize`，查询：`GET /tts/synthesize/{task_id}`
- TTS 局部重新生成：`POST /tts/synthesize/segments`
- TTS 取消：`POST /tts/synthesize/{task_id}/cancel`
- 项目待重新生成报告：`GET /tts/projects/{project_id}/stale-report`
- 项目分段音频：`GET /tts/projects/{project_id}/segments/{segment_id}/audio`
- 声音试听：`POST /voices/preview`
- 参考音频转写：`POST /voices/transcribe`
- 项目事件日志：`GET /projects/{project_id}/events`
- 文件浏览：`POST /system/files/browse`（仅允许白名单目录）

## WebSocket

- LLM 流：`/api/v1/ws/llm-stream/{task_id}`
- TTS 进度：`/api/v1/ws/tts-progress/{task_id}`
- 系统事件：`/api/v1/ws/system-events`

LLM/TTS 任务会推送 `task_status`、`model_loading`、`progress`、`complete`、`error`，并支持刷新后事件回放。

## 导入与重新生成工作流

当前推荐工作流：

1. 在“文本输入”页点击“导入工程 ZIP”，恢复项目
2. 在“剧本编辑”页修改片段内容
3. 到“合成导出”页查看“已修改待重新生成/配置变化待重新生成/缺失音频”标识
4. 点击“选择段落重新生成”自动勾选推荐段
5. 点击“重新生成已选段落”执行局部重建并自动更新整本音频与字幕

说明：

- 合成导出页支持每段“编辑 + 保存 + 重新生成”快捷闭环
- `stale-report` 返回 `reasons`（例如 `text_changed`、`tts_overrides_changed`、`missing_audio`）用于前端提示与推荐勾选

## 兼容性说明（工程 ZIP）

- 优先支持 v2 归档结构（`project/project.json`、`audio/full`、`audio/segments`、`subtitles`、`voices/presets.json`）
- 兼容旧归档常见结构：
  - 根目录 `project.json`
  - `audio/*`
  - `segments/*`
  - 根目录 `{project_id}.srt/.lrc`
- 兼容导入会通过 `warnings` 返回提示（前端会展示）

## P0 验收项对应

- README 与当前实现一致：已完成
- ASR 从占位返回改为真实 Whisper 转写：已完成
- 基础自动化冒烟测试：已完成
  - 测试文件：[test_api_smoke.py](/E:/softs/BeautyVoiceTTS/backend/tests/test_api_smoke.py)
  - 运行命令：

```powershell
.\.venv\Scripts\python.exe -m unittest discover backend/tests -v
```

## Phase 3 自动验收

新增了 Phase 3 的自动化验收入口（覆盖删除清理、导出链路、核心任务流）：

```powershell
.\.venv\Scripts\python.exe -m backend.tests.phase3_acceptance_runner
```

说明：
- 该脚本会按项输出 `PASS/FAIL` 汇总。
- 当前前端验收仍建议同时执行：

```powershell
cd frontend
npm test
```

## P2 回归验收

后端关键回归（配置/任务流/状态工厂/调度器）可一键执行：

```powershell
.\.venv\Scripts\python.exe -m backend.tests.p2_acceptance_runner
```

前端任务通道与 API 错误模型回归：

```powershell
cd frontend
npm test
```

## implementation_plan03 验收清单

可使用以下文档做逐项打勾验收：

- [implementation03-acceptance-checklist.md](/E:/softs/BeautyVoiceTTS/docs/implementation03-acceptance-checklist.md)

## 依赖注意事项

- `openai-whisper` 依赖系统 `ffmpeg`，请确保已安装并在 PATH 中可用。
- 若你只安装了其中一种 ASR 后端（例如仅 `faster-whisper`），系统会自动尝试可用后端。
- 若 ASR 后端都不可用，`/voices/transcribe` 会返回 `503` 和明确错误原因。

## 运行时数据边界

运行时数据统一位于 `backend/data`，目录职责如下：

- `config.json`：运行时配置（设置页保存结果）
- `projects/*.json`：项目主体数据（长期保留）
- `projects/*.events.jsonl`：项目事件日志（可按周期清理）
- `voices/`：声音预设与参考音频（长期保留）
- `output/`：导出音频、字幕、任务临时目录（可按时间清理）
- `cache/tts/`：可重建缓存（磁盘紧张时可清理）
- `tmp-tests/`：测试临时文件（可清理）

详细规则见：
- [runtime-data-governance.md](/E:/softs/BeautyVoiceTTS/docs/runtime-data-governance.md)

常用清理命令（PowerShell）：

```powershell
# 清理 TTS 缓存
Get-ChildItem .\backend\data\cache\tts -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

# 清理 7 天前的任务输出目录
Get-ChildItem .\backend\data\output -Directory | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force

# 清理 30 天前的事件日志
Get-ChildItem .\backend\data\projects\*.events.jsonl | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
```
