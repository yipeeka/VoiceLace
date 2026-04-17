# BeautyVoiceTTS 全面修复与提升计划

## 文档状态

- 状态：方案已整理，待实施
- 目标：结合 `project-file-open-fix-plan.md` 与现有代码审阅意见，形成一份覆盖“项目语义、状态管理、LLM 解析稳定性、前后端结构拆分、测试与验收”的主计划
- 约束：本文件只定义修复和提升计划，不包含代码修改
- 关联文档：
  - `docs/project-file-open-fix-plan.md`
  - `docs/project-recent-open-plan.md`
  - `docs/project-save-open-plan.md`
  - `docs/tts-overrides-plan.md`

## 一、背景与判断

当前 BeautyVoiceTTS 已经具备较完整的功能闭环：

- 文本输入
- LLM 结构化解析
- 剧本编辑
- 声音配置
- 分段与整段合成
- 工程导入导出
- 项目文件保存与打开

但随着功能持续累积，系统已经进入“可用但开始显露结构性压力”的阶段，主要表现为：

1. 项目文件打开、保存、另存、ZIP 导入、最近打开恢复尚未完全收敛成统一语义
2. 前端状态管理开始承载越来越多跨页面语义，部分链路存在恢复不完整和来源退化风险
3. LLM 解析链路对“坏 JSON 修复”和字符串后处理依赖较重，稳定性与延迟成本偏高
4. 后端路由、LLM 引擎、前端页面组件已出现明显的大文件、大职责聚合问题
5. 当前测试覆盖虽已具备基础回归能力，但对项目恢复、文件绑定、来源语义、LLM 结构化输出的覆盖仍不够系统

总体判断：

- Gemini 的审阅方向基本正确，尤其在“大文件、职责过载、解析链路不够稳、项目状态管理正在复杂化”这几方面判断成立
- 但仅从“理想架构重构”切入还不够，应优先先修复高 ROI 的语义与状态一致性问题
- 因此推荐采用“先稳语义与状态，再稳解析与结构，最后做系统性拆分”的推进方式

## 二、核心目标

本计划希望达成以下六个核心目标：

1. 把“打开项目文件”正式落地为“继续编辑同一个逻辑项目”，不再默认导入副本
2. 把“项目来源、最近打开、脚本恢复、保存/另存、文件绑定”统一成一个稳定的项目生命周期模型
3. 显著降低 LLM 结构化解析对坏 JSON 修复的依赖，提升稳定性与响应时延
4. 将后端胖路由、超大引擎、前端胖页面与胖 store 按职责逐步拆薄
5. 为项目恢复、解析流程、音频工作流建立更完整的自动化回归测试
6. 在不牺牲现有真实功能可用性的前提下完成技术债偿还

## 三、非目标

本轮主计划不包含以下事项：

- 不实现多人协作
- 不实现云端项目同步
- 不实现复杂权限体系
- 不一次性重写全部前端页面和后端服务层
- 不引入数据库替换当前文件持久化体系
- 不立即推翻现有 LLM provider 体系重新设计全套抽象

## 四、问题分层

## 4.1 P0：语义与状态一致性问题

这是当前最影响实际体验、也最该优先解决的一层。

主要问题：

1. “打开项目文件”语义仍偏向“导入副本”
2. 最近打开项目与真实脚本/文本恢复并非同一条链路
3. 项目来源 `local / project_file / archive_import` 目前前后端语义未完全统一
4. 保存、另存、导入、打开之间的边界刚建立，但仍需进一步固化
5. 项目文件、运行时项目、ZIP 导入项目三种身份还未完全形成稳定模型

## 4.2 P1：稳定性与性能问题

这是第二优先层，主要影响等待时间、解析鲁棒性和错误率。

主要问题：

1. LLM 解析存在对坏 JSON 修复的兜底依赖
2. provider 之间结构化输出能力利用程度不一致
3. llama-cpp 路径缺少更强约束的输出方案
4. 错误链路、超时、重试、fallback 的职责混在一起，不利于判断问题来源

## 4.3 P2：结构化技术债问题

这是第三优先层，决定未来维护成本和继续扩展的速度。

主要问题：

1. `backend/api/tts_routes.py`、`backend/api/project_routes.py` 已承担过多业务逻辑
2. `backend/engine/llm_engine.py` 同时负责 provider 生命周期、解析工作流、修复策略与 prompt 拼装
3. `frontend/src/pages/SynthesisPage.jsx`、`ScriptEditorPage.jsx`、`TextInputPage.jsx` 已明显偏胖
4. `frontend/src/stores/useProjectStore.js` 已开始承担过多来源与文件绑定逻辑

## 五、设计原则

后续所有实施应遵循以下原则：

1. 语义先统一，再谈重构
2. 运行时模型必须先于 UI 文案稳定
3. 先抽离高耦合热点，再做深层分层
4. 结构化输出优先于字符串修补
5. 新抽象必须由测试兜底，而不是靠页面人工回归维持
6. 所有提升都应尽量保证已有真实模型工作流不中断

## 六、工作流总图

推荐将后续实施拆为五条主线并行推进，但按优先级逐步落地：

1. 项目生命周期与文件语义收敛
2. LLM 结构化解析稳定性升级
3. 后端路由与服务层拆分
4. 前端页面与状态层拆分
5. 测试、日志、验收体系补齐

## 七、主线 A：项目生命周期与文件语义收敛

本主线建立在 `project-file-open-fix-plan.md` 的基础上，是当前最高优先级主线。

## A-1 目标

统一以下行为：

- 新建项目
- 打开项目文件
- 导入工程 ZIP
- 保存项目
- 另存项目
- 最近打开恢复
- 页面刷新/重启恢复

使之都落到同一个“运行时项目模型”之上。

## A-2 推荐运行时模型

建议把后端项目元数据统一表达为：

```json
{
  "project_origin": {
    "kind": "local | project_file | archive_import",
    "source_project_id": "optional",
    "project_file_name": "optional",
    "project_file_fingerprint": "optional"
  }
}
```

运行时层需要保证：

1. UI 不直接关心它来自 ZIP 还是 `.bvtproject.json`
2. UI 只处理一个统一的 `ProjectModel`
3. 保存时再由策略层决定写回绑定文件还是要求另存

## A-3 核心改造项

### A-3-1 打开项目文件语义修正

正式定义为：

- 优先复用已存在的逻辑项目
- 只有无匹配项目时才首次创建

推荐复用优先级：

1. 前端已有句柄绑定
2. 后端 `project_file_fingerprint` 精确命中
3. `source_project_id` 弱匹配候选
4. 都失败才创建新项目

### A-3-2 保存/另存收敛

- 保存：
  - 已绑定文件则回写
  - 未绑定则等同于另存
- 另存：
  - 选择新路径写出
  - 成功后切换当前项目绑定

### A-3-3 最近打开恢复收敛

启动恢复必须同时恢复：

- `currentProject`
- `script`
- `sourceText`
- 项目来源语义
- 文件绑定状态

不能只恢复当前项目壳而不恢复脚本内容。

### A-3-4 ZIP 导入语义固定

ZIP 导入继续保留为：

- 恢复一个本地工作副本

必须与项目文件打开严格区分：

- ZIP 不建立默认项目文件回写绑定
- ZIP 项目默认属于 `archive_import`

## A-4 细化任务

### Phase A1：后端模型与持久化扩展

任务：

1. 扩展 `Project` 模型与读写兼容
2. 补充 `project_origin` 默认值
3. 增加项目文件指纹计算工具

### Phase A2：项目文件打开语义修正

任务：

1. 重写 `/projects/import/project-file` 内部语义
2. 返回 `open_mode = reused | created`
3. 在复用时避免创建新项目项

### Phase A3：前端项目管理语义收敛

任务：

1. 将 `useProjectStore` 中来源、最近打开、文件绑定逻辑收敛到单一管理入口
2. 避免页面分别维护各自的恢复逻辑
3. 启动恢复后同步脚本与文本状态

### Phase A4：保存/另存/打开统一验收

任务：

1. 固化桌面软件风格的保存语义
2. 明确 ZIP 导入与项目文件打开的 UI 差异
3. 补齐回归测试和手动验收步骤

## 八、主线 B：LLM 结构化解析稳定性升级

这是当前第二优先级主线。

## B-1 目标

降低以下问题：

- 模型返回残缺 JSON
- 解析等待时间过长
- fallback 过多导致体验不稳定
- provider 间行为差异过大

## B-2 当前判断

当前 `llm_engine.py` 的问题不是“完全不能用”，而是职责过于聚合：

1. provider 生命周期管理混在一起
2. chunk 解析与 prompt 组装混在一起
3. JSON 解码、提取、修复、重试混在一起
4. provider-specific 行为差异没有足够显式地抽象出来

## B-3 推荐方向

### B-3-1 先做 provider 结构化输出能力分级

建议明确三类路径：

1. OpenAI 路径：
   - 优先使用官方结构化输出能力
2. Gemini 路径：
   - 优先使用 JSON 响应约束或等价结构化能力
3. llama-cpp 路径：
   - 逐步评估 grammar / schema 约束是否适合当前模型与库版本

不要把三类 provider 继续放在一套模糊的“字符串后处理”模型里。

### B-3-2 先减少 repair，再决定是否彻底移除 repair

不建议一步到位删除全部 repair 逻辑。

推荐路线：

1. 先把 repair 降级为最后兜底
2. 先提高首轮结构化输出成功率
3. 观察真实解析成功率与时延
4. 再决定是否彻底移除部分 repair 分支

### B-3-3 拆出解析工作流服务

建议把以下能力从 `llm_engine.py` 拆出：

- `LLMClient` 抽象
- `LlamaCppClient`
- `OpenAIClient`
- `GeminiClient`
- `PromptParserService`
- `JsonPayloadDecoder`

## B-4 细化任务

### Phase B1：provider 抽象分离

任务：

1. 定义统一的 `BaseLLMClient`
2. 分别实现 llama/OpenAI/Gemini 客户端
3. 将模型加载与解析调用从一个超大类中拆开

### Phase B2：结构化输出工作流重构

任务：

1. 抽出 prompt 组装器
2. 抽出 JSON 解析与提取器
3. 明确修复逻辑触发条件与日志

### Phase B3：性能与失败模式治理

任务：

1. 记录 chunk 首次成功率
2. 记录 repair 命中率
3. 记录 provider 级时延与失败类型
4. 为 llama-cpp 结构化输出能力做一次版本适配评估

## 九、主线 C：后端结构拆分

## C-1 目标

降低路由层与业务层耦合，缩小胖文件，提升可测试性。

## C-2 推荐边界

建议逐步形成以下职责边界：

- `api/`
  - 只负责请求接收、参数校验、HTTP 响应映射
- `services/`
  - 负责业务编排与工作流
- `repositories/` 或 `storage/`
  - 负责项目、脚本、输出、元数据持久化
- `engine/`
  - 负责模型推理本身

## C-3 优先拆分对象

优先从以下文件开始：

1. `backend/api/project_routes.py`
2. `backend/api/tts_routes.py`
3. `backend/engine/llm_engine.py`

## C-4 细化任务

### Phase C1：项目服务抽取

建议抽取：

- `ProjectService`
- `ProjectFileService`
- `ProjectImportService`

承接以下逻辑：

- 项目文件打开
- ZIP 导入
- 保存与另存
- 项目元数据更新

### Phase C2：TTS 工作流服务抽取

建议抽取：

- `TTSService`
- `SynthesisTaskService`
- `ExportService`

承接以下逻辑：

- 合成任务创建与取消
- 分段/整段导出
- 波形、音频、归档文件组织

### Phase C3：错误与日志统一

建议统一：

- 业务异常类型
- API 错误映射
- 关键工作流日志字段

## 十、主线 D：前端页面与状态层拆分

## D-1 目标

把页面文件与 store 从“页面脚本集合体”逐步拆成“状态层 + 领域组件 + 容器页面”。

## D-2 推荐拆分方向

### D-2-1 `SynthesisPage.jsx`

建议拆为：

- `SynthesisPageContainer`
- `FullAudioPanel`
- `SegmentTimeline`
- `SegmentRow`
- `SegmentEditorPanel`
- `SynthesisToolbar`
- `StaleStatusBadge`

### D-2-2 `ScriptEditorPage.jsx`

建议拆为：

- `ScriptEditorContainer`
- `ScriptSegmentList`
- `ScriptSegmentEditor`
- `InsertSegmentControls`
- `CharacterSelect`
- `EmotionSelect`
- `ScriptDirtyBanner`

### D-2-3 `TextInputPage.jsx`

建议拆为：

- `ProjectPicker`
- `ImportActions`
- `SaveActions`
- `SourceTextEditor`
- `ProjectOpenSaveController`

### D-2-4 `useProjectStore.js`

建议拆分为：

- `useProjectStore`
- `projectFileBindingStore`
- `projectRecentStore`
- `projectSourceStore`

或者保留单 store，但把复杂逻辑抽到独立 `utils/projectLifecycle.js` / `services/projectClient.js`。

## D-3 细化任务

### Phase D1：项目生命周期前端编排器

目标：

- 让页面不直接揉在一起处理“导入、打开、保存、另存、恢复”

### Phase D2：合成导出页组件化

目标：

- 降低 SynthesisPage 体积
- 保留现有交互能力
- 防止再次出现“为了改一处，把别的功能删掉”的回归

### Phase D3：剧本编辑页组件化

目标：

- 抽离片段编辑器与新增片段控制器
- 降低脏状态、保存状态、插入位置等逻辑的耦合度

## 十一、主线 E：测试、日志、验收体系补齐

## E-1 目标

把当前“功能能跑”升级为“核心语义有稳定回归保护”。

## E-2 后端测试补齐

必须新增或加强：

1. 同一项目文件重复打开返回同一 `project_id`
2. 不同项目文件返回不同项目
3. ZIP 导入仍生成独立项目
4. `project_origin` 持久化正确
5. 启动恢复场景所需项目元数据完整可读
6. LLM provider 路径的结构化输出与 fallback 行为可测
7. 关键导出、归档、波形数据链路的异常测试

## E-3 前端测试补齐

必须新增或加强：

1. 最近打开恢复会同时恢复脚本与源文本
2. 项目来源标识在重启后不退化
3. 保存/另存在不同绑定状态下行为正确
4. 打开同一项目文件不新增项目列表项
5. `SynthesisPage` 分段编辑、局部重生成、脏状态标识的回归用例
6. 片段插入、删除、修改的未保存标识统一性测试

## E-4 日志与可观测性

建议新增统一日志字段：

- `project_id`
- `project_origin.kind`
- `project_file_fingerprint`
- `provider`
- `chunk_index`
- `repair_attempted`
- `repair_provider`
- `open_mode`

用于定位以下问题：

- 为什么重复打开生成新项目
- 为什么最近打开恢复后页面空白
- 为什么某一 provider 解析慢或失败

## E-5 验收方式

建议每个主线都配套：

1. 自动化测试
2. 手动页面验收脚本
3. 关键日志验收点

## 十二、实施优先级

推荐按以下顺序推进：

### P0：先稳用户语义与状态

包含：

- 主线 A 全部
- 主线 E 中与项目恢复、文件打开、保存/另存相关测试

目标：

- 彻底解决“打开项目文件像导入副本”的问题
- 彻底解决“最近打开恢复不完整”的问题

### P1：再稳 LLM 解析链路

包含：

- 主线 B
- 主线 E 中与解析工作流相关测试与日志

目标：

- 降低 repair 依赖
- 缩短解析等待时间
- 让 provider 差异可观测、可调优

### P2：再做结构拆分

包含：

- 主线 C
- 主线 D

目标：

- 降低维护成本
- 降低回归概率
- 提升后续功能扩展速度

## 十三、阶段性交付建议

为了控制风险，建议分三次交付：

### 交付 1：项目语义版

交付内容：

- 项目文件打开复用
- 保存/另存统一
- 最近打开恢复完整
- 来源语义稳定

验收标准：

- 用户能稳定地继续编辑同一项目

### 交付 2：解析稳定版

交付内容：

- provider 抽象初步拆出
- repair 依赖降低
- 结构化输出策略升级
- 关键日志与指标完善

验收标准：

- 真实解析成功率与时延有可观测改善

### 交付 3：结构减压版

交付内容：

- 路由抽薄
- 页面组件化
- store 逻辑下沉
- 测试覆盖进一步补齐

验收标准：

- 主要热点文件显著缩小
- 关键页面修改风险降低

## 十四、风险与注意事项

1. 若先做大规模重构而不先稳定项目语义，用户侧混乱不会减少，反而会增加回归风险
2. 若急于删除 JSON repair 而不先提高首轮结构化输出成功率，真实模型路径可能出现功能倒退
3. 若项目来源语义只保留在前端本地状态，重启和跨浏览器行为仍会不稳定
4. 若页面拆分时没有配套测试，容易再次出现“一个功能修好了，另一个功能被误删”的问题
5. 若日志不统一，后续很难判断问题出在 provider、状态恢复、还是路由编排层

## 十五、推荐结论

BeautyVoiceTTS 现在最需要的不是“立刻全面重写”，而是按层次完成一次有节奏的修复和减压：

1. 先把项目文件、保存、恢复的语义彻底做对
2. 再把 LLM 结构化解析做稳
3. 最后再系统地拆胖路由、胖页面、胖 store

`project-file-open-fix-plan.md` 应作为本主计划的 P0 子计划继续推进；Gemini 的审阅则主要补充了 P1/P2 层面的方向。两者结合后的推荐策略是：

- 先修语义和状态一致性
- 再修解析链路稳定性
- 最后做结构重构与长期可维护性建设

这是当前风险最低、收益最高、也最符合 BeautyVoiceTTS 现阶段演进状态的一条路线。
