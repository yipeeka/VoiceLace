# P2 阶段审计报告（截至当前工作区）

## 1. 范围

本报告对照 `docs/comprehensive-repair-improvement-plan.md` 的 P2（主线 C + 主线 D）进行阶段审计：

- 主线 C：后端结构拆分
- 主线 D：前端页面与状态层拆分

结论先行：

- P2 的 **C1/C2/C3 已完成大部分核心拆分**，后端路由明显瘦身，职责边界已建立。
- P2 的 **D1 已完成首阶段**（项目生命周期工具层抽出）。
- P2 的 **D2/D3 尚未系统实施**（页面组件化尚未进入实质拆分阶段）。

## 2. 当前关键体积（字节）

- `backend/api/tts_routes.py`: `22264`
- `backend/api/project_routes.py`: `38709`
- `backend/engine/llm_engine.py`: `20685`
- `frontend/src/stores/useProjectStore.js`: `11376`
- `frontend/src/pages/SynthesisPage.jsx`: `30574`
- `frontend/src/pages/ScriptEditorPage.jsx`: `24351`
- `frontend/src/pages/TextInputPage.jsx`: `15632`

说明：

- `tts_routes.py` 已从历史更大体量显著下降，但仍可继续压缩。
- 前端 `SynthesisPage.jsx` / `ScriptEditorPage.jsx` 仍偏大，是 D2/D3 的主要目标。

## 3. 已完成项（按计划映射）

### C1 项目服务抽取

已落地：

- `backend/services/project_file_service.py`
- `backend/services/project_import_service.py`

路由接入：

- `backend/api/project_routes.py` 的项目文件导入/导出及匹配复用逻辑已迁移到 service。

### C2 TTS 工作流服务抽取

已新增并接入：

- `backend/services/tts_export_service.py`
- `backend/services/tts_query_service.py`
- `backend/services/tts_stale_service.py`
- `backend/services/tts_path_service.py`
- `backend/services/tts_scan_service.py`
- `backend/services/tts_segment_service.py`
- `backend/services/tts_finalize_service.py`
- `backend/services/tts_task_service.py`
- `backend/services/tts_runtime_service.py`
- `backend/services/tts_lifecycle_service.py`

效果：

- `tts_routes.py` 中“归档导出、波形查询、stale 判定、路径计算、scan 计划、单段处理、整段收尾、任务生命周期响应、事件发送”等重逻辑已下沉。

### C3 错误与日志统一（阶段性）

已完成：

- 归档导出日志已统一关键字段（如 `project_id`、`segment_count`、`preset_count`、`latest_tts_task_id`）。
- 任务状态响应已集中至 `build_tts_status_response(...)`，减少分散实现。

待完善：

- 业务异常类型与 API 错误映射尚未统一成独立错误层（仍主要依赖 `HTTPException` + 文本 detail）。

### D1 项目生命周期前端编排器（第一阶段）

已完成：

- 抽出 `frontend/src/utils/projectLifecycle.js`
- `useProjectStore.js` 已接入该工具层，降低 store 内部杂糅。

### D2/D3 页面组件化

当前状态：

- 尚未进行系统性组件拆分。
- `SynthesisPage.jsx`、`ScriptEditorPage.jsx` 仍是下一阶段主要改造对象。

## 4. 测试覆盖增量

新增（代表性）：

- `backend/tests/test_project_file_service.py`
- `backend/tests/test_project_import_service.py`
- `backend/tests/test_tts_export_service.py`
- `backend/tests/test_tts_query_service.py`
- `backend/tests/test_tts_stale_service.py`
- `backend/tests/test_tts_path_service.py`
- `backend/tests/test_tts_scan_service.py`
- `backend/tests/test_tts_segment_service.py`
- `backend/tests/test_tts_finalize_service.py`
- `backend/tests/test_tts_task_service.py`
- `backend/tests/test_tts_runtime_service.py`
- `backend/tests/test_tts_lifecycle_service.py`

并行补强：

- LLM 相关拆分测试：`test_llm_parser_service.py`、`test_llm_parse_orchestrator.py`、`test_llm_single_runner.py`、`test_llm_engine_stats.py`

## 5. 阶段验收结论

### 通过项

- 后端服务边界已形成，可按 service 粒度维护与测试。
- `tts_routes.py` 已从“超大杂糅”转为“编排主导 + service 调用”。
- 关键回归测试已覆盖，并在近期回归中通过（后端与前端测试均为通过状态）。

### 未完成项

- `project_routes.py` 仍偏大，尚未拆成更清晰的 `ProjectService` 主编排层。
- 前端 D2/D3（页面组件化）尚未启动系统拆分，页面体积仍偏大。
- 错误模型和日志 schema 仍未统一到“全局错误层/结构化错误码”。

## 6. 建议的下一步（P2 收尾到可签收）

1. **Project 路由收口**
- 把 `project_routes.py` 再拆 1-2 个服务（建议：`project_maintenance_service.py`、`project_archive_import_service.py`）。

2. **D2：Synthesis 页面组件化**
- 优先拆 `SegmentTimeline` / `SegmentRow` / `SynthesisToolbar`，先做无行为改动的容器化迁移。

3. **D3：ScriptEditor 页面组件化**
- 抽出片段编辑器和插入控制组件，减少页面级状态交错。

4. **C3：错误语义统一**
- 增加统一业务错误类型（例如 `DomainError(code, message, meta)`），路由层统一映射 HTTP 响应结构。

## 7. 建议的签收标准（P2 完整完成）

达到以下条件可视为 P2 完成：

- `tts_routes.py` 和 `project_routes.py` 都降到“路由编排主导”，核心逻辑均位于 service。
- `SynthesisPage.jsx`、`ScriptEditorPage.jsx` 完成第一轮组件化拆分并保持现有行为。
- 后端与前端回归套件保持通过，且新增拆分模块均有独立单测。
- 形成一份最终的 P2 验收清单（测试命令 + 手工回归脚本 + 关键日志点）。
