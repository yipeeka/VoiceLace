# VoiceLace 改进实施计划

## 目标

本计划基于当前项目代码审阅结果制定，目标不是新增功能，而是优先提升以下能力：

- 稳定性：降低配置错乱、状态漂移、文件损坏、模型加载异常带来的故障概率
- 可维护性：减少重复映射、隐式全局状态和松散接口带来的后续改动成本
- 可观测性：让“为什么失败”“当前运行在哪种模式”更容易定位
- 安全边界：限制不必要的本地文件暴露面

本计划按 `P0 / P1 / P2` 分阶段实施，优先顺序以“风险控制”和“收益密度”为准。

---

## 当前进度（2026-04-13）

### 已完成

- `P0-1` 文件浏览接口白名单化
- `P0-2` 统一系统加载与配置接口模型
- `P0-3` 去除前端设置链路静默失败
- `P0-4` 项目持久化改为原子写入
- `P1-1` AppState 工厂化（启动生命周期挂载，测试同步迁移）
- `P1-2` 收敛前后端配置字段命名
- `P1-3` 拆分设置页职责（系统状态卡 + 调度配置卡）
- `P1-4` 统一实时任务错误模型，并收尾为共享任务通道工具层
- `P2-1` 强化系统状态面板（分组展示 + 路径摘要 + 运行环境诊断）
- `P2-2` 增补回归测试矩阵（后端 + 前端联动覆盖）
- `P2-3` 运行时数据边界文档与清理策略

### 待完成

- 无（当前计划项已全部完成）

### 本轮新增完成

- `P2-1` 强化系统状态面板（完成）
  - 状态字段已按「模型运行 / ASR / 运行环境 / GPU」分组展示
  - 长路径已做摘要显示并保留完整路径悬停提示
  - 状态卡已展示 `python_executable`、`llama_cpp_available`、`llama_cpp_module_path`
- `P2-3` 运行时数据边界文档与清理策略
  - 文档：[docs/runtime-data-governance.md](./docs/runtime-data-governance.md)
  - README 已补充运行时数据目录职责与安全清理命令
- `P2-2` 新增回归测试（增量）
  - `backend/tests/test_state_factory.py`
  - `backend/tests/test_model_orchestrator.py`
  - `frontend/tests/taskChannel.test.mjs` 增补取消态不重连场景
  - `frontend/tests/taskChannel.test.mjs` 增补重连耗尽自定义错误分支
  - `backend/tests/test_api_smoke.py` 增补 `/system/load-llm` 部分更新不覆盖其他配置场景
  - 新增一键后端验收入口：`backend/tests/p2_acceptance_runner.py`

### 验收证据（已执行）

- 后端一键验收：`.\.venv\Scripts\python.exe -m backend.tests.p2_acceptance_runner` -> `Ran 27 tests ... OK`
- 前端测试：`npm test` -> `pass 15 / fail 0`

---

## Phase P0：稳定性与边界收口

### P0-1 文件浏览接口白名单化

#### 背景

当前 [backend/api/system_routes.py](./backend/api/system_routes.py) 的 `/api/v1/system/files/browse` 可直接浏览传入路径，缺少目录边界限制。

#### 目标

- 仅允许浏览受控目录
- 禁止访问项目范围外或敏感路径
- 为前端提供明确错误提示

#### 涉及文件

- [backend/api/system_routes.py](./backend/api/system_routes.py)
- [backend/models/api_models.py](./backend/models/api_models.py)
- [frontend/src/stores/useSettingsStore.js](./frontend/src/stores/useSettingsStore.js)

#### 实施步骤

1. 定义可浏览根目录白名单。
2. 将请求路径解析后校验为白名单子路径。
3. 对越权路径返回 `403` 和可读错误信息。
4. 前端选择目录失败时显示明确 toast 或错误文案。
5. 为白名单内和白名单外路径补充测试。

#### 验收标准

- 白名单内目录可正常浏览
- 白名单外目录访问返回 `403`
- 页面上能看到“路径不允许访问”而不是静默失败

---

### P0-2 统一系统加载与配置接口模型

#### 背景

当前系统配置主入口使用 `OrchestratorConfigPayload`，但 `/load-llm`、`/load-tts` 仍使用裸 `dict`，会造成字段约束不一致和行为分叉。

#### 目标

- 所有系统级配置和加载入口统一使用 Pydantic 模型
- 避免运行时直接散写 `state.orchestrator.config`
- 明确“保存配置”和“按当前配置加载模型”的职责边界

#### 涉及文件

- [backend/api/system_routes.py](./backend/api/system_routes.py)
- [backend/models/api_models.py](./backend/models/api_models.py)
- [backend/engine/model_orchestrator.py](./backend/engine/model_orchestrator.py)

#### 实施步骤

1. 为 `load-llm`、`load-tts` 定义请求模型。
2. 去除接口内部裸字段读写，统一通过结构化 payload 更新。
3. 明确接口职责：
   - `PUT /system/orchestrator/config` 只负责保存运行时配置
   - `POST /system/load-llm` / `load-tts` 只负责按当前配置触发加载
4. 补充非法字段、缺失字段、范围错误的接口测试。

#### 验收标准

- 非法参数返回 `422`
- 设置页保存和手动加载使用相同字段语义
- LLM/TTS 加载行为不再依赖散落的默认值

---

### P0-3 去除前端设置链路的静默失败

#### 背景

当前 [frontend/src/stores/useSettingsStore.js](./frontend/src/stores/useSettingsStore.js) 中多个关键动作在失败时直接 `return null` 或忽略异常，用户难以判断失败原因。

#### 目标

- 所有关键系统操作在失败时可见
- 区分“系统未启动”“接口失败”“配置保存失败”“模型卸载失败”
- 将错误反馈与状态刷新解耦，避免“失败后界面看起来像成功”

#### 涉及文件

- [frontend/src/stores/useSettingsStore.js](./frontend/src/stores/useSettingsStore.js)
- [frontend/src/pages/SettingsPage.jsx](./frontend/src/pages/SettingsPage.jsx)
- [frontend/src/utils/errors.js](./frontend/src/utils/errors.js)

#### 实施步骤

1. 为 `refreshSystemStatus`、`loadOrchestratorConfig`、`saveOrchestratorConfig`、`resetOrchestratorConfig`、`manualUnloadLLM`、`manualUnloadTTS` 增加统一错误处理。
2. 将静默失败改为：
   - store 中保留错误状态
   - UI 上显示 toast 或就地错误文案
3. 对“首次加载时后端尚未启动”保留柔性处理，但要有可区分的状态标识。

#### 验收标准

- 断开后端时设置页能明确提示失败
- 保存失败不会误刷新为成功状态
- 卸载失败能看到错误原因

---

### P0-4 项目持久化改为原子写入

#### 背景

当前项目和事件日志是直接文件写入，缺少原子替换和损坏恢复策略。

#### 目标

- 避免项目 JSON 因中断写入损坏
- 降低并发保存导致的半写入风险
- 为后续自动保存和批量任务打基础

#### 涉及文件

- [backend/persistence.py](./backend/persistence.py)
- [backend/api/project_routes.py](./backend/api/project_routes.py)

#### 实施步骤

1. `save_project()` 改为写入临时文件后 `replace`。
2. 明确 JSON 编码、刷新、替换顺序。
3. 为事件日志追加增加最小防护：
   - 明确单条事件写入格式
   - 读取时保留坏行跳过逻辑
4. 增加项目保存与删除的回归测试。

#### 验收标准

- 项目文件不会出现半截 JSON
- 异常中断后仍能读到最后一次完整版本
- 相关测试覆盖保存、删除和事件读取

---

## Phase P1：结构收敛与维护成本下降

### P1-1 AppState 工厂化，减少导入副作用

#### 背景

当前 [backend/state.py](./backend/state.py) 在导入时直接创建全局 `app_state`，隐藏了真实初始化副作用。

#### 目标

- 将状态初始化与模块导入分离
- 提升测试隔离性和生命周期可控性
- 为未来多进程、热重载和更复杂启动逻辑留空间

#### 涉及文件

- [backend/state.py](./backend/state.py)
- [backend/main.py](./backend/main.py)
- 相关测试文件

#### 实施步骤

1. 提供 `create_app_state()` 工厂函数。
2. 在应用启动阶段挂载 state，而不是导入即初始化。
3. 调整 `get_app_state()` 依赖获取方式。
4. 改造相关测试，避免全局状态跨用例污染。

#### 验收标准

- 应用可正常启动
- 测试可以创建隔离 state
- 热重载或重复导入不重复初始化重量级对象

---

### P1-2 收敛前后端配置字段命名

#### 背景

前端 store 当前维护了多组“展示字段名”和“后端字段名”的并行映射，扩展成本较高。

#### 目标

- 前后端尽量使用同一套字段名
- 前端仅保留必要的展示态衍生字段
- 避免 load/save/reset 三处重复转换

#### 涉及文件

- [frontend/src/stores/useSettingsStore.js](./frontend/src/stores/useSettingsStore.js)
- [frontend/src/pages/SettingsPage.jsx](./frontend/src/pages/SettingsPage.jsx)
- [backend/models/api_models.py](./backend/models/api_models.py)

#### 实施步骤

1. 列出当前重复别名字段。
2. 确定一套规范字段名作为主字段。
3. 将 store 中的 load/save/reset 提取为统一映射函数。
4. 移除不必要的双字段并补回归测试。

#### 验收标准

- 新增一个配置项只需改动一套主字段
- 设置保存、加载、重置结果一致
- 前端不再到处判断 `a ?? b ?? c`

---

### P1-3 拆分设置页职责

#### 背景

设置页承担了表单、状态展示、模型控制、错误展示等多重职责，继续扩展会越来越重。

#### 目标

- 把设置页拆成清晰子模块
- 降低单组件复杂度
- 为后续增加 LLM/TTS/ASR 选项保留结构空间

#### 涉及文件

- [frontend/src/pages/SettingsPage.jsx](./frontend/src/pages/SettingsPage.jsx)
- 新增设置子组件目录

#### 实施步骤

1. 拆分为：
   - 模型配置区
   - 运行策略区
   - 系统状态区
2. 将表单逻辑与状态展示逻辑分离。
3. 统一按钮行为与保存反馈。

#### 验收标准

- 页面逻辑更清晰
- 子组件职责单一
- 页面行为和当前功能保持一致

---

### P1-4 统一实时任务错误模型

#### 背景

脚本解析和合成任务都有 WS + REST 状态同步逻辑，但错误表达和重连后的恢复行为还不够统一。

#### 目标

- 统一任务错误和连接错误的前端处理模型
- 降低“任务实际完成但前端误判失败”的概率
- 让用户更容易理解当前状态

#### 涉及文件

- [frontend/src/stores/useScriptStore.js](./frontend/src/stores/useScriptStore.js)
- [frontend/src/stores/useSynthesisStore.js](./frontend/src/stores/useSynthesisStore.js)
- 相关 WebSocket hook 与 UI 提示

#### 实施步骤

1. 统一任务状态字段命名。
2. 明确区分：
   - WS 断开
   - 重连中
   - 任务失败
   - 任务已完成但连接关闭
3. 将回查接口逻辑提取为共享工具。

#### 验收标准

- 同类错误展示一致
- 重连恢复成功时不会误报失败
- 超时、取消、失败路径清晰可见

---

## Phase P2：可观测性与工程化补强

### P2-1 强化系统状态面板

#### 目标

- 把当前运行环境和模型状态可视化
- 缩短故障定位路径

#### 建议展示项

- 当前 Python 解释器
- `llm_backend` / `tts_backend`
- fallback 是否生效
- 最近一次 LLM/TTS/ASR 错误
- 当前模型路径摘要
- 当前 think mode / auto serial / auto unload 状态

#### 验收标准

- 用户不看日志也能判断“为什么模型没工作”

---

### P2-2 增补回归测试矩阵

#### 目标

- 让关键行为变更可回归
- 防止修一处伤另一处

#### 建议覆盖点

- 配置保存 / 重置 / 重启恢复
- LLM 加载成功 / fallback / 加载失败
- 项目原子保存 / 删除清理
- WS 重连与任务状态回查
- 设置页关键错误反馈

#### 验收标准

- 核心路径具备自动化回归能力

---

### P2-3 整理运行时数据边界

#### 目标

- 明确运行时数据目录职责
- 方便清理、备份和迁移

#### 涉及范围

- `backend/data/config.json`
- 项目 JSON
- 事件日志
- 输出音频与归档
- 临时任务目录

#### 实施步骤

1. 定义目录职责文档。
2. 补充清理策略与保留策略。
3. 在 README 中补充说明。

#### 验收标准

- 数据目录结构可解释、可维护

---

## 推荐实施顺序

1. P0-1 文件浏览接口白名单化
2. P0-2 系统配置入口统一
3. P0-3 去除前端静默失败
4. P0-4 项目持久化原子写入
5. P1-2 收敛配置字段命名
6. P1-1 AppState 工厂化
7. P1-3 拆分设置页
8. P1-4 统一实时任务错误模型
9. P2-1 强化系统状态面板
10. P2-2 增补回归测试矩阵
11. P2-3 整理运行时数据边界

---

## 里程碑建议

### M1：边界与稳定性收口

完成 P0 全部事项，保证系统行为更安全、错误更可见、项目数据更稳。

### M2：配置与状态收敛

完成 P1-1 ~ P1-3，显著降低后续继续加设置项和模型开关时的维护成本。

### M3：工程化补强

完成 P1-4 与 P2，全链路提升可观测性和回归能力。

---

## 完成定义

以下条件满足后，可认为本轮改进完成：

- 系统配置入口统一且具备类型校验
- 设置页关键失败场景不再静默
- 项目文件写入具备原子性
- 文件浏览接口具备明确安全边界
- 运行状态可解释，回退链路可观察
- 关键链路具备基础自动化回归测试

## 最终状态

以上完成定义均已满足，本计划收口完成。

