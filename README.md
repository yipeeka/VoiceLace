# BeautyVoiceTTS

本项目是一个本地运行的多角色有声书工作台，核心流程是：

1. 文本输入（LLM 解析剧本）
2. 剧本编辑（逐段改写/新增/删除）
3. 声音配置（角色绑定预设）
4. 合成导出（全量或局部重生成）

当前版本支持真实模型（`llama-cpp-python` / `OmniVoice` / `Whisper`），并提供 WebSocket 实时进度、任务取消、事件回放、工程导入导出。

---

## 3 分钟上手（推荐先看）

### 1) 启动

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-real.txt
cd frontend
npm install
cd ..
.\.venv\Scripts\python.exe start.py
```

启动后：
- 前端默认 `http://127.0.0.1:5173`
- 后端默认 `http://127.0.0.1:8000`

### 2) 系统设置页先配模型路径

至少确认：
- `LLM 后端`（`llama_cpp` / `openai` / `gemini` / `mock`）
- `LLM 模型路径`（本地 GGUF 时）
- `TTS 模型目录`
- `ASR 模型目录/名称`

说明：
- 设置页保存到 `backend/data/config.json`
- `.env` 只作为启动默认值和敏感项（API Key）
- 设置页修改不会自动改写 `.env`

### 3) 按页面顺序跑一次完整流程

1. **文本输入**：新建项目 -> 粘贴文本 -> 选择解析模式 -> 开始解析  
2. **剧本编辑**：检查分段和说话人，修改后记得保存  
3. **声音配置**：给每个角色分配声音预设  
4. **合成导出**：先全量合成一次；后续只重生成“需更新段落”  

### 4) 日常高频操作

- 打开项目文件：文本输入页 -> `打开项目文件`
- 导入工程 ZIP：文本输入页 -> `导入工程 ZIP`
- 项目改名：文本输入页工具栏 `项目新名称` + `改名`
- 删除同名副本/清理重复：文本输入页工具栏 `更多`
- 局部修音：合成导出页逐段 `重新生成` 或 `需更新段落重新生成`

---

## 用户使用手册（详细）

## 页面 1：文本输入

- 项目工具栏支持：
  - 项目切换
  - 新建项目
  - 改名
  - 打开项目文件
  - 导入工程 ZIP
  - 更多菜单（删除当前项目、删除同名副本、清理重复项目）
- 解析模式：
  - `两步解析（推荐）`：更稳，适合复杂长文
  - `经典单步解析`：更快，兼容旧行为
- 自定义提示词：
  - 仅对单步链路生效
  - 两步链路使用内置 Step1/Step2 提示词

## 页面 2：剧本编辑

- 可逐段编辑：`speaker/type/text/emotion/tts_overrides`
- 新增片段可插入指定位置
- 任何添加/删除/修改都先进入草稿态，保存后才写入项目
- 有未保存改动会有明确提示

## 页面 3：声音配置

- 角色分配列表按剧本真实角色聚合
- 支持声音预设创建、试听、绑定
- 预设支持排序与保存成功提示

## 页面 4：合成导出

- 显示每段状态：已同步 / 缺失音频 / 配置变化待重生成 / 已修改待重生成
- 支持：
  - 单段 `重新生成`
  - 批量 `需更新段落重新生成`
  - 从某段开始连播
- 完整音频与分段音频都支持波形显示（后端预计算 peaks）

---

## 安装与配置（开发/部署）

## 依赖安装

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-real.txt
cd frontend
npm install
cd ..
```

## `.env` 常用项

参考 [`.env.example`](/E:/softs/BeautyVoiceTTS/.env.example)。

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

BV_OPENAI_API_KEY=your-openai-key
BV_OPENAI_MODEL=gpt-4.1-mini
BV_GEMINI_API_KEY=your-gemini-key
BV_GEMINI_MODEL=gemini-2.5-flash

BV_TTS_MODEL_PATH=E:\softs\BeautyVoiceTTS\models\OmniVoice
BV_TTS_DEVICE=cuda:0

BV_ASR_MODEL_PATH=base
BV_ASR_DEVICE=cuda:0

BV_AUTO_SERIAL=true
BV_AUTO_UNLOAD_LLM_AFTER_PARSE=true
BV_AUTO_LOAD_TTS_BEFORE_SYNTH=true
BV_ALLOW_MOCK_FALLBACK=true
```

说明：
- `BV_LLM_BACKEND` 支持 `llama_cpp` / `openai` / `gemini` / `mock`
- `BV_ALLOW_MOCK_FALLBACK=false` 时，模型加载失败会直接报错，不自动回退 mock
- 若 `backend/data/config.json` 存在，运行时优先读该配置

## 启动方式

一键：

```powershell
.\.venv\Scripts\python.exe start.py
```

分开启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

```powershell
cd frontend
npm run dev
```

---

## API 与 WS 速查

Base URL: `http://localhost:8000/api/v1`

### API

- 系统状态：`GET /system/status`
- 工程导入：`POST /projects/import/archive`
- 项目文件导入：`POST /projects/import/project-file`
- 项目文件导出：`GET /projects/{project_id}/export/project-file`
- 项目列表：`GET /projects`
- 项目更新（含改名）：`PUT /projects/{project_id}`
- LLM 解析：`POST /llm/parse`
- LLM 状态：`GET /llm/parse/{task_id}`
- LLM 取消：`POST /llm/parse/{task_id}/cancel`
- TTS 合成：`POST /tts/synthesize`
- TTS 局部重生成：`POST /tts/synthesize/segments`
- TTS 状态：`GET /tts/synthesize/{task_id}`
- TTS 取消：`POST /tts/synthesize/{task_id}/cancel`
- 待重生成报告：`GET /tts/projects/{project_id}/stale-report`
- 分段音频：`GET /tts/projects/{project_id}/segments/{segment_id}/audio`
- 声音试听：`POST /voices/preview`
- 参考音频转写：`POST /voices/transcribe`
- 项目事件：`GET /projects/{project_id}/events`

### WebSocket

- LLM 流：`/api/v1/ws/llm-stream/{task_id}`
- TTS 进度：`/api/v1/ws/tts-progress/{task_id}`
- 系统事件：`/api/v1/ws/system-events`

---

## 测试与验收

## 前端

```powershell
cd frontend
npm test
npm run build
```

## 后端核心回归

```powershell
.\.venv\Scripts\python.exe -m unittest backend.tests.test_api_smoke backend.tests.test_task_flows backend.tests.test_persistence
.\.venv\Scripts\python.exe -m unittest backend.tests.test_llm_json_utils backend.tests.test_api_smoke backend.tests.test_task_flows backend.tests.test_persistence
```

## 阶段验收脚本

```powershell
.\.venv\Scripts\python.exe -m backend.tests.p2_acceptance_runner
.\.venv\Scripts\python.exe -m backend.tests.phase3_acceptance_runner
```

---

## 常见问题（Troubleshooting）

## 1) 解析失败后回退到 mock

先看系统状态：

```powershell
curl "http://127.0.0.1:8000/api/v1/system/status"
```

重点确认：
- `llm_backend`、`llama_cpp_available`
- 模型路径是否存在
- API Key / model 名是否正确

## 2) Gemini 400/404

- 先确认模型名是否可用（与你账号区域一致）
- 对 Gemini/OpenAI 建议仅传 `temperature`，其余惩罚项不要传
- 如果日志出现 `responseSchema unsupported`，当前实现会自动回退 `responseMimeType`

## 3) WaveSurfer 初始化失败/波形异常

- 先确认音频 URL 可访问
- 刷新页面后重试
- 若完整音频可播但波形异常，系统会保留播放能力并降级交互

## 4) “项目删除不完”

通常是同名不同 ID 的历史副本：
- 用工具栏 `更多 -> 删除同名副本`
- 或 `更多 -> 清理重复项目`

## 5) ASR 不可用

- 检查 `BV_ASR_MODEL_PATH` 与设备配置
- 仅安装了一个 ASR 后端也可运行，系统会自动选择可用后端

---

## 数据目录说明

运行时数据位于 `backend/data`：

- `config.json`：运行时配置
- `projects/*.json`：项目数据
- `projects/*.events.jsonl`：任务事件日志
- `voices/`：声音预设与参考音频
- `output/`：合成产物与导出文件
- `cache/tts/`：可重建缓存
- `tmp-tests/`：测试临时文件

详细规则见：
- [runtime-data-governance.md](/E:/softs/BeautyVoiceTTS/docs/runtime-data-governance.md)

---

## 相关文档

- [implementation03-acceptance-checklist.md](/E:/softs/BeautyVoiceTTS/docs/implementation03-acceptance-checklist.md)
- [comprehensive-repair-improvement-plan.md](/E:/softs/BeautyVoiceTTS/docs/comprehensive-repair-improvement-plan.md)
