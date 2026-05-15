# VoiceLace `tts_overrides` 实施方案

## 文档状态

- 状态：方案设计完成
- 执行状态：暂不实施
- 适用范围：剧本编辑页、合成导出页的片段级 TTS 参数覆盖能力

## 一、背景

当前项目中的 `tts_overrides` 已经存在于数据结构和前端编辑界面中：

- 片段编辑可填写 `tts_overrides` JSON
- 前端会校验其必须为 JSON object
- 后端会把 `tts_overrides` 纳入缓存指纹和 stale 检测
- 合成结果元数据中也会记录 `source_tts_overrides`

但它目前仍有一个关键缺口：

- **后端没有把 `segment.tts_overrides` 真正传入 OmniVoice 推理参数**

这导致当前行为出现“半实现”状态：

1. 用户修改了 `tts_overrides`
2. 系统会认为片段“配置变化待重新生成”
3. 重新生成后，声音结果却可能完全不变

这会直接影响功能可信度，因此需要把 `tts_overrides` 从“参与缓存判断的结构字段”升级为“真正参与合成的片段级覆盖参数”。

## 二、现状判断

## 2.1 当前已存在能力

- 前端编辑与 JSON 校验已具备
- 项目持久化已具备
- stale / fingerprint / cache 机制已具备
- 段级重新生成链路已具备

换句话说，`tts_overrides` 的外围基础设施已经存在，缺少的是：

- 参数白名单设计
- 参数校验
- 参数优先级规则
- 后端合成透传

## 2.2 当前 OmniVoice 在本项目中已实际使用的参数

当前后端 `TTSEngine.synthesize_to_file()` 已会传入这些参数：

- `text`
- `num_step`
- `guidance_scale`
- `denoise`
- `ref_audio`
- `ref_text`
- `instruct`
- `speed`

结合本地安装的 OmniVoice 代码，可确认当前版本还支持至少以下片段级参数：

- `duration`
- `speed`
- `denoise`
- `num_step`
- `guidance_scale`

另外在批量推理脚本中还能看到：

- `language_id`
- `language_name`

但这两个字段当前项目并没有形成完整的语言控制链路，不建议第一版直接开放。

## 三、目标

本方案目标是让 `tts_overrides` 成为**真正生效的片段级 TTS 覆盖参数**，用于控制单个片段的合成行为。

需要达成的效果：

1. 用户填写的 `tts_overrides` 会真实影响该片段的合成结果
2. 不支持的字段会被明确拦截，而不是静默失效
3. 片段级参数覆盖优先级清晰，不与角色预设和全局配置打架
4. 重新生成后的结果与 stale 检测、缓存指纹保持一致
5. 验收时可以清楚判断“改了参数 -> 声音确实变化”

## 四、非目标

本方案第一版明确不包含以下内容：

- 不开放“任意 JSON 无限制透传到模型”
- 不把 `tts_overrides` 扩展成角色级默认配置系统
- 不处理 OmniVoice 所有潜在隐藏参数
- 不在第一版中开放 `ref_audio/ref_text/instruct` 的片段级覆盖
- 不在第一版中加入复杂语言切换能力
- 不在第一版中做跨模型、多后端统一参数抽象

## 五、核心设计原则

1. `tts_overrides` 必须采用白名单，而不是任意透传
2. 用户写下的字段必须“要么生效，要么报错”，不能沉默失败
3. 优先级必须固定：片段覆盖 > 角色预设 / 项目合成配置
4. 已参与 stale / fingerprint 的字段，必须和真实生效字段保持一致
5. 第一版优先保证稳定、可解释、可验收

## 六、推荐字段范围

## 6.1 第一版建议正式支持

推荐第一版只开放以下字段：

- `speed`
- `duration`
- `denoise`
- `num_step`
- `guidance_scale`

### 推荐理由

- `speed`
  - 当前项目已经有角色预设速度概念
  - 做成片段覆盖最直观
  - 用户容易理解

- `duration`
  - OmniVoice 当前版本支持
  - 适合处理“某一句希望更短/更长”的需求
  - 与段级重新生成价值很高

- `denoise`
  - 当前全局配置已存在同名参数
  - 片段级局部覆盖逻辑清晰

- `num_step`
  - 直接影响单段生成质量 / 耗时
  - 技术上好接入

- `guidance_scale`
  - 直接影响生成风格强度
  - 技术上好接入

## 6.2 第一版不建议支持

- `ref_audio`
- `ref_text`
- `instruct`
- `language_id`
- `language_name`
- 任意未知字段

### 不建议原因

- `ref_audio/ref_text`
  - 会与当前角色预设引用音频系统冲突
  - 还会引入文件路径、安全性、导入导出、资产绑定复杂度

- `instruct`
  - 容易与预设生成人设冲突
  - 用户不容易判断最终到底用了哪套 instruct

- `language_id/language_name`
  - 当前项目并未建立完整语言配置 UI 与验证链路
  - 先做会导致规则不完整

- 未知字段
  - 若静默忽略，会继续制造“写了但没效果”的问题

## 七、参数优先级设计

推荐统一采用以下优先级：

1. `segment.tts_overrides`
2. `VoicePreset`
3. `project.synthesis_config`
4. `TTSEngine` 默认值 / OmniVoice 默认值

### 具体规则

- `speed`
  - 若片段里设置了 `tts_overrides.speed`，则覆盖 `preset.speed`
  - 若片段未设置，则继续使用 `preset.speed`

- `duration`
  - 若设置，则直接传入 OmniVoice
  - 一旦设置 `duration`，其效果优先于 `speed`
  - 文档和 UI 提示中必须明确这一点

- `denoise`
  - 若片段里设置，则覆盖项目合成配置中的 `denoise`

- `num_step`
  - 若片段里设置，则覆盖项目合成配置中的 `num_step`

- `guidance_scale`
  - 若片段里设置，则覆盖项目合成配置中的 `guidance_scale`

## 八、数据校验规则

后端必须做白名单和类型校验，不能只信任前端。

## 8.1 建议字段规则

- `speed`
  - 类型：`number`
  - 建议范围：`0.5 ~ 2.0`

- `duration`
  - 类型：`number`
  - 建议范围：`> 0`
  - 可额外限制上界，例如 `<= 60`

- `denoise`
  - 类型：`boolean`

- `num_step`
  - 类型：`integer`
  - 建议范围：`1 ~ 128`

- `guidance_scale`
  - 类型：`number`
  - 建议范围：`0.0 ~ 10.0`

## 8.2 校验失败策略

推荐使用“明确失败”策略：

- 发现未知字段：返回 `400`
- 字段类型不对：返回 `400`
- 数值超范围：返回 `400`

错误信息建议明确到字段名，例如：

- `Unsupported tts_overrides field: language_id`
- `tts_overrides.speed must be a number between 0.5 and 2.0`

不要采用“部分成功、部分忽略”的宽松策略，否则用户很难判断哪些参数真生效。

## 九、后端实施方案

## 9.1 新增统一解析函数

建议在后端新增一个专门的 `tts_overrides` 解析/校验函数，例如：

- `normalize_tts_overrides(overrides: dict | None) -> dict`

职责：

- 空值归一化为 `{}`
- 校验字段白名单
- 校验类型
- 校验范围
- 返回规范化结果

建议不要把校验逻辑散落在路由和引擎层各处。

## 9.2 建议放置位置

推荐位置二选一：

- `backend/engine/tts_engine.py` 附近，贴近实际推理逻辑
- 或新增独立模块，例如 `backend/engine/tts_overrides.py`

更推荐第二种：

- 更清晰
- 更利于单元测试
- 以后若 TTS 后端增多，也更容易复用

## 9.3 修改 TTS 引擎签名

建议把 `TTSEngine.synthesize_to_file()` 扩展为支持片段覆盖参数，例如：

```python
async def synthesize_to_file(
    self,
    text: str,
    output_path: Path,
    preset: VoicePreset | None = None,
    config: SynthesisConfig | None = None,
    tts_overrides: dict | None = None,
) -> Path:
```

## 9.4 参数合并顺序

在引擎内部组装 `kwargs` 时，建议流程如下：

1. 先写入基础 `text`
2. 再写入项目合成配置得到的默认推理参数
3. 再写入角色预设推导出的参数
4. 最后写入 `tts_overrides` 规范化后的参数

这样逻辑最符合“片段覆盖最高优先级”的语义。

## 9.5 关键处理规则

### `speed`

- 当前已有 `preset.speed`
- 若 `tts_overrides.speed` 存在，则最终以覆盖值为准

### `duration`

- 直接追加到 `kwargs`
- 若同时存在 `speed`，文档与注释中要明确：`duration` 是更强约束

### `denoise / num_step / guidance_scale`

- 当前项目已经支持项目级配置
- 片段级覆盖只需要在最终 `kwargs` 中覆盖掉对应值

## 十、路由与任务流改造

## 10.1 路由层传参

当前合成流程中，片段级 `tts_overrides` 虽然参与缓存 key，但没有真正传到引擎。

实施时需要在 [backend/api/tts_routes.py](/E:/softs/VoiceLace/backend/api/tts_routes.py) 中补齐：

- 从 `segment.tts_overrides` 读取值
- 调用 `synthesize_to_file(..., tts_overrides=segment.tts_overrides)`

## 10.2 保持 fingerprint 一致

由于 `tts_overrides` 已经参与 cache key 和 stale report：

- 只要最终真正应用到推理参数，现有 stale 逻辑基本就是一致的

实施时只需确认一件事：

- 参与指纹计算的 `tts_overrides` 内容，应与最终 `normalize_tts_overrides()` 结果一致

推荐做法：

- **指纹和元数据都基于“规范化后的 overrides”**

否则会出现：

- 原始 JSON 不同，但规范化后含义相同
- 却被视为不同缓存键

例如：

```json
{"speed": 1}
{"speed": 1.0}
```

这两者最好统一成相同的规范化结果。

## 十一、前端实施方案

## 11.1 第一版前端目标

第一版前端不需要大改 UI，只需要把当前 JSON 编辑体验补到“可理解、可校验”。

建议保留：

- `tts_overrides` JSON 文本框

并补充：

- 支持字段说明
- 示例占位符
- 更明确的报错提示

## 11.2 建议提示文案

建议在编辑区或帮助文案中注明：

- 当前支持字段：`speed`, `duration`, `denoise`, `num_step`, `guidance_scale`
- `duration` 与 `speed` 同时设置时，优先以 `duration` 为准
- 未知字段会导致生成失败

## 11.3 是否做表单化 UI

第一版不建议立即改成表单化控件。

原因：

- 当前已有 JSON 输入框，改动最小
- 用户群体很可能能接受 JSON
- 先把后端能力打通，验收更直接

后续若需要更强可用性，再考虑做“高级参数表单编辑器”。

## 十二、测试计划

## 12.1 后端单元测试

建议新增以下测试：

1. `normalize_tts_overrides(None)` 返回空对象
2. 合法字段组合可通过校验
3. 未知字段返回错误
4. 错误类型返回错误
5. 越界数值返回错误
6. `speed: 1` 与 `speed: 1.0` 规范化结果一致

## 12.2 后端流程测试

建议覆盖以下场景：

1. 设置 `tts_overrides.speed`，生成调用中最终使用覆盖值
2. 设置 `tts_overrides.duration`，生成调用中最终包含 `duration`
3. 片段覆盖 `num_step/guidance_scale/denoise` 能覆盖项目级配置
4. 未知字段导致任务失败并返回明确错误
5. 修改 `tts_overrides` 后 stale report 正确标记
6. 重生成后 stale 状态恢复为同步

## 12.3 前端测试

建议新增：

1. JSON 合法对象能通过现有校验
2. 非对象 JSON 报错
3. 错误提示文案符合预期
4. 占位符/帮助文案展示支持字段

## 12.4 真实功能验收

至少做一轮真实页面验收：

1. 选定一条片段
2. 设置 `{"speed": 1.2}`
3. 重新生成该片段
4. 人耳可感知该句语速变化
5. 再设置 `{"duration": 6}`
6. 重新生成
7. 该句时长明显逼近目标值

## 十三、实施阶段划分

## Phase 1：规则收敛

目标：

- 确定第一版白名单字段
- 确定优先级规则
- 确定校验策略

产出：

- 字段表
- 校验规则
- 错误语义

## Phase 2：后端接线

目标：

- 新增 `normalize_tts_overrides`
- 扩展 `synthesize_to_file` 签名
- 在 TTS 路由中把 `segment.tts_overrides` 真正透传

产出：

- 片段级参数覆盖真正生效

## Phase 3：前端提示补齐

目标：

- 补充支持字段说明
- 补充占位符和错误提示

产出：

- 用户可理解哪些字段能写、怎么写

## Phase 4：测试与验收

目标：

- 完成后端测试
- 完成前端测试
- 完成真实片段重生成验收

产出：

- 可回归、可验收、可持续维护

## 十四、难度评估

## 14.1 总体难度

如果只做本方案第一版白名单能力：

- **总体难度：中低**

## 14.2 原因

难度不高的原因：

- 前端输入与项目结构已经存在
- stale / cache / fingerprint 已经接入
- OmniVoice 支持的核心字段已明确
- 段级重新生成链路已经存在

真正需要实现的核心只有：

- 参数校验
- 参数规范化
- 参数透传

## 14.3 主要风险点

1. 指纹计算与真实透传参数不一致
2. `duration` 与 `speed` 语义不清导致用户误解
3. 未知字段处理不严格，继续制造“无效配置”
4. 未来若增加更多后端，参数语义需要重新抽象

但这些都属于可控风险，不属于高复杂度风险。

## 十五、推荐结论

推荐按以下策略实施：

1. 第一版只支持：
   - `speed`
   - `duration`
   - `denoise`
   - `num_step`
   - `guidance_scale`
2. 后端采用白名单严格校验
3. 片段级参数覆盖优先级最高
4. 指纹、stale、合成透传统一基于规范化后的值
5. 先保持 JSON 输入框，不立即做复杂表单化

这是当前项目下**收益最高、实现成本最低、验收边界最清晰**的落地方式。

## 十六、实施清单

实施时建议按以下顺序推进：

1. 新增 `tts_overrides` 规范化与校验模块
2. 扩展 `TTSEngine.synthesize_to_file()` 参数签名
3. 在 TTS 路由中透传片段级 `tts_overrides`
4. 将缓存 key / stale 元数据统一改为使用规范化后的 overrides
5. 补齐前端帮助文案
6. 补齐后端与前端测试
7. 做一轮真实片段重生成验收

