# BeautyVoiceTTS 代码审阅报告

> 审阅时间: 2026-04-21 · 对比上次审阅 (2026-04-17)
> 审阅范围: 全栈 (FastAPI 后端 + React/Vite 前端)

---

## 一、上次审阅问题改进情况

上次标记的三大问题，本轮改进非常显著：

| 问题 | 上次状态 | 当前状态 | 评价 |
|------|----------|----------|------|
| 后端 Fat Controller | `tts_routes.py` 47KB, `project_routes.py` 31KB | 21KB / 7.7KB | ✅ **大幅改善** |
| LLM Engine 单体类 | 751 行，所有后端集成挤在一个文件 | 拆出 `llm_clients.py`, `llm_parser.py`, `llm_single_runner.py`, `llm_parse_orchestrator.py` | ✅ **结构清晰** |
| 前端 SynthesisPage 臃肿 | ~30KB 单文件 | 13.5KB，拆出 8 个子组件 + `useSynthesisActions` hook | ✅ **大幅改善** |
| Service 层缺失 | 无 | `backend/services/` 21 个 service 文件 | ✅ **架构升级完成** |
| 后端测试覆盖 | 不清晰 | 37 个测试文件 | ✅ **质的飞跃** |

---

## 二、当前发现的问题

### 🔴 P0 — 需要尽快修复的问题

#### 1. `llm_engine.py` 仍然 47KB / 1077 行 — 还在膨胀

拆分工作虽然做了一半，但 `llm_engine.py` 本身并没有因此瘦下来。它从 751 行膨胀到了 1077 行。原因是新增了 two-step pipeline 逻辑 (`_parse_text_two_step_pipeline`, `_merge_two_step_output`, `_analyze_two_step_structure_drift` 等)直接堆在同类里。

**现状**: 新模块 (`llm_clients.py`, `llm_parser.py` 等) 承载的是被抽出去的旧逻辑，但新功能又全加回了 `LLMEngine` 类。

**建议**: 
- `_parse_text_two_step_pipeline` + `_merge_two_step_output` + `_analyze_two_step_structure_drift` + `_to_structured_draft` + `_build_step2_input_payload` → 抽到 `llm_two_step_pipeline.py`
- `_extraction_prompt()` + `_structure_extraction_prompt()` + `_tts_enrichment_prompt()` → 抽到 `prompts.py`（已有此文件但未被使用）
- `_apply_non_verbal_tags_to_text` + `_normalize_non_verbal_tag` → 抽到 `script_builder.py` 或 `llm_post_processor.py`
- 目标是 `LLMEngine` 类自身控制在 ~300 行，职责仅为模型生命周期管理 + 调度入口

#### 2. `project_routes.py` 行尾混乱 — LF / CRLF 混搭

```
4: \r\n    # CRLF
5: from fastapi import APIRouter, Depends, File, HTTPException, UploadFile\r\n
...
56: \r\n
57: \r\n
58: @router.post("")\r\n
59: async def create_project(payload: CreateProjectRequest, state=Depends(get_app_state)):\n  # LF
```

整个文件同时存在 `\n` 和 `\r\n`，很可能是某次 merge 或编辑器切换导致的。虽然不影响运行，但：
- git diff 噪声大
- 部分 linter 会报错
- 显示代码作者对规范的关注不够

**建议**: `dos2unix` 或编辑器统一为 LF，并在 `.gitattributes` 添加 `* text=auto eol=lf`。

#### 3. `useSynthesisStore.js` — `startSynthesis` 与 `startPartialSynthesis` 超过 95% 代码重复

[startSynthesis](file:///e:/softs/BeautyVoiceTTS/frontend/src/stores/useSynthesisStore.js#L29-L241) 和 [startPartialSynthesis](file:///e:/softs/BeautyVoiceTTS/frontend/src/stores/useSynthesisStore.js#L242-L463) 两个方法各自约 210 行，几乎完全相同。差异仅为：
- API endpoint (`/tts/synthesize` vs `/tts/synthesize/segments`)
- 请求 body 多一个 `segment_ids` + `rebuild_full`
- Toast 文案略有不同（"合成" vs "局部合成"）

**建议**: 提取 `_runSynthesisChannel(options)` 内部方法，差异通过参数注入。这会将 ~420 行代码压缩到 ~250 行，且后续修改只需改一处。

---

### 🟡 P1 — 建议修复的设计问题

#### 4. `LLMEngine` 内大量 `@staticmethod` 代理方法毫无意义

```python
# llm_engine.py L62-76
@staticmethod
def _structured_output_schema() -> dict[str, Any]:
    return structured_output_schema()

@staticmethod
def _structured_output_schema_structure_only() -> dict[str, Any]:
    return structured_output_schema_structure_only()

@classmethod
def _gemini_response_schema(cls) -> dict[str, Any]:
    return gemini_response_schema()
```

还有 `_strip_json_fences`, `_extract_json_object`, `_validate_structured_payload`, `_should_attempt_repair` — 全部是对 `llm_parser.py` 同名函数的无操作代理。这些方法：
- 没有额外逻辑
- 没有需要重写的理由
- 只增加了间接层和阅读难度

**建议**: 在调用处直接 `from backend.engine.llm_parser import ...`，删掉这些 1:1 代理 `@staticmethod`。

#### 5. Gemini 客户端用原始 `urllib` 手挛 HTTP — 缺少超时管理和连接复用

[llm_clients.py](file:///e:/softs/BeautyVoiceTTS/backend/engine/llm_clients.py) 中的 Gemini 调用全部使用 `urllib.request`：

```python
import time  # ← 在函数体内 import
retryable_codes = {429, 500, 503}
for retry in range(4):
    req = urllib_request.Request(url, data=data, ...)
    with urllib_request.urlopen(req, timeout=90) as resp:
        ...
```

问题：
- `time.sleep()` 在 `asyncio.to_thread` 内运行，虽然不阻塞事件循环，但仍占线程池
- 没有连接池，每次都是新 TCP 连接
- `import time` 在函数体内（L142），应放顶部
- retry 重建 `Request` 对象是因为 `urlopen` 消费了 `data` — 这本身就是 urllib 的 footgun

**建议**: 迁移到 `httpx.AsyncClient` (已有 `asyncio.to_thread` 的使用模式，说明项目对 async 不排斥)。或至少用 `requests.Session` 获得连接复用。

#### 6. TTS 采样率硬编码不一致

```python
# tts_engine.py L144
wav_file.setframerate(24000)  # OmniVoice 实际采样率

# tts_engine.py L202
wav_file.setframerate(22050)  # mock 静音

# tts_routes.py L78
sample_rate = 22050  # 全局合成变量
```

如果实际用 OmniVoice 合成的音频是 24000Hz，但 `tts_routes.py` 里 `combined_frames` 用 22050 进行拼接/混音，最终导出的全曲音频会出现变速问题。

**建议**: 从 TTS 引擎获取实际 sample rate 并向上传播，而不是在 routes 层硬编码。

#### 7. `_run_synthesis_task` 过程函数仍然太长 (~275 行)

[tts_routes.py L52-325](file:///e:/softs/BeautyVoiceTTS/backend/api/tts_routes.py#L52-L325)

虽然核心业务已被抽到 service 层（`build_synthesis_scan_plan`, `process_synthesis_segment`, `finalize_rebuild_full` 等），但 `_run_synthesis_task` 本身仍然充当了"协调器"角色，包含：
- 项目加载 / 保存
- 目录创建
- 缓存扫描
- segment 循环 + 事件发射
- 最终合并 + 导出
- 错误处理 + 状态回写

**建议**: 将其拆为 `SynthesisTaskRunner` 类或一个 service 级别的 `run_synthesis_pipeline()` 函数，routes 层只做 `create_task → run_pipeline → return`。

---

### 🟢 P2 — 优化建议

#### 8. `extract_json_object` 只返回第一个顶层 `{}` — 对数组型响应无能为力

[llm_parser.py L140-171](file:///e:/softs/BeautyVoiceTTS/backend/engine/llm_parser.py#L140-L171)

如果 LLM 返回 `[{...}, {...}]`（数组），或者前面有垃圾文本后面跟了一个 JSON 数组，当前实现会返回空字符串。虽然 schema 要求 segments 被包裹在 `{...}` 里，但这是一个脆弱假设。

**建议**: 增加 `extract_json_array` 的 fallback path，或者在 `extract_json_object` 开头加一个 `[` 的起点检测。

#### 9. `LLMEngine.__init__` 有 18 个实例属性 — God Object 味道

```python
def __init__(self) -> None:
    self.is_loaded = False
    self.model_path = ""
    self.clip_model_path = ""
    self.model_name = ""
    self.chat_format = ...
    self.enable_llama_cpp_think_mode = ...
    self.backend_name = "mock"
    self.last_error = ""
    self._llm = None
    self._openai_client = None
    self._loaded_backend = "mock"
    self._loaded_n_ctx = ...
    self._loaded_n_gpu_layers = ...
    self._loaded_n_threads = ...
    self._loaded_clip_model_path = ...
    self._loaded_enable_think_mode = ...
    self.last_parse_stats = {}
    self.think_mode_effective = False
    self.think_mode_support = "unknown"
    self.last_load_mode = ""
    self.handler_fallback_reason = ""
```

这是 God Object 的典型症状。建议将 `_loaded_*` 系列打包为 `@dataclass LoadedModelConfig`，将 `think_mode_*` + `handler_fallback_reason` + `last_load_mode` 打包为 `@dataclass LoadDiagnostics`。

#### 10. 前端缺少 TypeScript — 长期风险

当前前端全部是 `.jsx`，Zustand store 没有类型定义。`useSynthesisStore` 里 564 行无类型代码，`useScriptStore` 17KB，都是纯 JS。随着 store 逻辑越来越复杂（websocket 状态机、stale detection、segment draft...），没有类型系统会导致：
- 重构时无法确认调用点兼容性
- 新增字段容易遗漏 reset
- Store state shape 变更无法被静态捕获

**建议**: 至少对 store 层引入 `.ts` / JSDoc `@typedef`，给关键 state shape 和 action 返回值加类型。

#### 11. 前端 `projectStore.test.mjs` 未被纳入 `npm test`

```json
"test": "node --test tests/errors.test.mjs tests/api.test.mjs tests/taskChannel.test.mjs tests/taskChannelBridge.test.mjs tests/stale.test.mjs tests/segmentDraft.test.mjs tests/scriptEditorState.test.mjs tests/scriptDiff.test.mjs tests/scriptEditorDirty.test.mjs"
```

`projectStore.test.mjs` 存在但没被包含在 test 命令里。

#### 12. 根目录 Plan 文件堆积

项目根有 7 个散落的 markdown plan 文件：
```
UI_plan.md (33KB)
change-plan.md (9.7KB)  
implementation_plan01.md (13KB)
implementation_plan02.md (13KB)
implementation_plan03.md (25KB)
improve-plan.md (13KB)
plan.md (77KB!)
preset-import-plan.md (10KB)
waveform-peaks-plan.md (15KB)
```

总计超过 200KB 的计划文档和 `tmp_verify_llama_think.py` 这种一次性脚本直接放在项目根目录。

**建议**: 全部移入 `docs/plans/` 或 `docs/archive/`。已实施完毕的 plan 标记为 archived。

---

## 三、架构亮点（做得好的地方）

1. **Service 层分拆粒度合理** — `backend/services/` 下 21 个文件，每个文件 1-5KB，职责边界清晰（`tts_scan_service.py`, `tts_stale_service.py`, `project_file_open_service.py` 等）。这是上次审阅建议的核心，执行得很到位。

2. **Two-step LLM pipeline 设计** — 先做结构解析（Step1: 拆段 + 识别角色），再做 TTS 参数注入（Step2: emotion + non_verbal），并通过 `_analyze_two_step_structure_drift` 做 guard 检查。这比单步 all-in-one prompt 更可靠，也更容易 debug。

3. **Structured Output schema 的渐进降级** — OpenAI `json_schema` 失败降级到 `json_object`，Gemini `responseSchema` 400 降级到纯 `responseMimeType`，且用 `_gemini_schema_unsupported_models` 缓存降级决策避免重复试错。

4. **`ModelOrchestrator` 的互斥加载设计** — 通过 `auto_serial` + `asyncio.Lock` 确保 LLM 和 TTS 不同时占用 VRAM，`ensure_llm_ready` 会先卸载 TTS。这对单 GPU 场景非常实用。

5. **前端 `taskChannel` + `taskChannelBridge` 抽象** — WebSocket 重连、状态同步、超时处理被统一封装，`useSynthesisStore` 和 `useScriptStore`（LLM 解析进度）共享同一套基础设施。

6. **后端测试覆盖** — 从上次基本无测试到现在 37 个测试文件，覆盖了 service 层、engine 层、模型编排、JSON 解析、项目生命周期等。

---

## 四、优先级总结

| 优先级 | 项目 | 改动量 |
|--------|------|--------|
| 🔴 P0-1 | `llm_engine.py` 继续瘦身 — 抽出 two-step pipeline 和 prompts | 中 |
| 🔴 P0-2 | 修复 `project_routes.py` 混合行尾 | 小 |
| 🔴 P0-3 | 合并 `useSynthesisStore` 的两个几乎相同的合成方法 | 中 |
| 🟡 P1-4 | 删除 `LLMEngine` 中的无意义 static 代理方法 | 小 |
| 🟡 P1-5 | Gemini 客户端迁移到 `httpx` 或 `requests` | 中 |
| 🟡 P1-6 | 修复 TTS 采样率不一致 (24000 vs 22050) | 小 |
| 🟡 P1-7 | `_run_synthesis_task` 提升为 service/runner | 中 |
| 🟢 P2-8 | `extract_json_object` 增加数组支持 | 小 |
| 🟢 P2-9 | `LLMEngine` 属性打包为 dataclass | 小 |
| 🟢 P2-10 | 前端 store 层引入 TypeScript | 大 |
| 🟢 P2-11 | `projectStore.test.mjs` 加入 test 命令 | 小 |
| 🟢 P2-12 | 根目录 plan 文件归档 | 小 |
