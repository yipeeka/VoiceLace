# BeautyVoiceTTS 详细实施计划 v3.1

## 主题

本计划聚焦“工程可回灌 + 分段重新生成”的主工作流，但本轮 **只做方案细化，不实施代码**：

1. 项目工程导入
   目标是让“完整工程 ZIP”不仅可下载，还能重新导入到系统中继续编辑，包括剧本、分段音频、完整音频、字幕、声音预设快照和参考音频。
2. 分段重新生成
   目标是当用户只想修正少量“不满意的段落”时，不必整本重跑，而是仅重新生成目标片段，并自动重建整本成品。
3. 编辑与生成闭环
   目标是让“文本输入页 -> 剧本编辑页 -> 合成导出页”形成连续工作流，导入、修改、标记和重新生成都能自然衔接。

---

## 一、目标与边界

### 目标

- 导出的项目工程可以完整回灌到系统中
- 导入工程 ZIP 在文本输入页可直接进入，合成导出页保留快捷入口
- 导入后项目可继续进行剧本编辑、声音调整、试听和导出
- 剧本编辑页修改过的段，在合成导出页能被明确标识或自动勾选
- 支持仅对选中段执行重新生成
- 局部重新生成完成后，整本音频和字幕自动更新
- 合成导出页支持按行快速编辑，形成“编辑 -> 标记 -> 重新生成”闭环
- 系统能识别哪些段需要重新生成，哪些段可以复用已有音频

### 非目标

- 本轮不做跨机器绝对路径完全无差异恢复
- 本轮不做多用户并发工程协作
- 本轮不做工程级版本对比或三方合并
- 本轮不做“按字词级”局部修音，仅做“按段落级”重新生成
- 本轮不做复杂版本历史和撤销栈设计

### 设计原则

- 先把“任务结果”升级为“项目资产”
- 导入默认“导入为新项目”，避免覆盖风险
- 保持对当前 ZIP 归档格式的向后兼容
- 文本输入页作为工程导入主入口，合成导出页保留副入口
- 用户可见文案优先使用“重新生成”“需重新生成”，避免“脏段”术语
- 编辑与重新生成解耦，用户先确认修改，再决定生成范围
- 先做可落地 MVP，再补自动待生成识别和 UI 精修

---

## 二、现状评估

### 已有能力

- 当前已有完整工程 ZIP 导出接口：
  [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)
- 当前已有项目 JSON 持久化：
  [backend/persistence.py](/E:/softs/BeautyVoiceTTS/backend/persistence.py)
- 当前已有分段音频生成与整本拼接
- 当前已有单段音频播放与整本导出
- 当前已有按项目保存的剧本、角色、声音分配、合成参数

### 当前缺口

- 分段音频主要以 `task_id` 目录存在，偏任务态，不是稳定项目资产
- 当前导出 ZIP 不包含项目依赖的声音预设快照和参考音频
- 当前没有以文本输入页为主的“导入工程 ZIP”入口与恢复逻辑
- 当前没有“仅合成部分 segment”的接口与状态流
- 当前没有项目级“这段音频是否过期”的判定机制
- 当前剧本编辑页的修改没有同步到合成导出页的“待重新生成”标识或预勾选
- 当前合成导出页不能像剧本编辑页那样对单行做快速编辑

### 结论

这些需求不能只靠加一个导入按钮和一个局部合成按钮解决，必须先补一层“项目资产层”，再把“编辑状态 -> 待重新生成状态 -> 重新生成动作”串成统一工作流。

---

## 三、总体实施路线

### Phase 0：项目资产层落地

先把分段音频、整本音频、字幕等内容从“任务目录临时结果”升级为“项目固定资产”。

### Phase 1：工程归档格式 v2

在现有完整工程 ZIP 基础上，补齐声音预设快照、参考音频和版本化 manifest。

### Phase 2：工程导入与双入口接入

新增导入接口和双入口前端接入，支持把 ZIP 重新导回系统，恢复为可编辑项目。

### Phase 3：分段重新生成 MVP 与合成页轻编辑

新增局部重新生成接口、任务状态和前端交互，只更新指定段并重建整本，同时在合成导出页提供快捷编辑能力。

### Phase 4：已修改段识别、预勾选与体验打磨

基于指纹识别出哪些段“需重新生成”，并在 UI 上明确提示、自动勾选候选段和引导补生成。

---

## 四、核心方案设计

### 4.1 项目资产目录

建议新增项目级固定输出目录：

```text
backend/data/output/projects/{project_id}/
├── full/
│   ├── mix.wav
│   └── mix.mp3
├── segments/
│   ├── {segment_id}.wav
│   └── ...
├── subtitles/
│   ├── book.srt
│   └── book.lrc
└── manifest.json
```

说明：

- `task_id` 目录仍可保留给任务期实时播放或调试
- 任务完成后，应把最终结果同步到项目资产目录
- 导出 ZIP 与导入恢复一律基于项目资产目录，而不是某个历史 task 目录

### 4.2 项目资产元数据

建议在项目侧增加一块资产清单，推荐直接挂到 `Project` 模型中，而不是单独另起一份散文件。

建议新增模型草案：

```python
class SegmentAsset(BaseModel):
    segment_id: str
    audio_relpath: str
    duration_ms: int = 0
    fingerprint: str = ""
    source_task_id: str | None = None
    created_at: str = ""
    status: Literal["ready", "missing", "stale"] = "ready"


class ProjectAudioAssets(BaseModel):
    latest_task_id: str | None = None
    full_wav_relpath: str | None = None
    full_mp3_relpath: str | None = None
    subtitle_srt_relpath: str | None = None
    subtitle_lrc_relpath: str | None = None
    segments: dict[str, SegmentAsset] = Field(default_factory=dict)
    archive_schema_version: int = 2
```

然后在 [backend/models/project.py](/E:/softs/BeautyVoiceTTS/backend/models/project.py) 中为 `Project` 增加：

```python
audio_assets: ProjectAudioAssets = Field(default_factory=ProjectAudioAssets)
```

设计原因：

- 导入、导出、局部合成、待重新生成识别都需要统一索引
- 项目 JSON 本身就是当前系统的主状态源，把资产清单并入 `Project` 更便于持久化和回灌

### 4.3 指纹机制

每段音频需要一个稳定指纹，用于判断“当前文本和当前配置下的音频是否仍然有效”。

建议复用并扩展当前 [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py) 中 `_segment_cache_key()` 的思路，统一为项目级 `segment_fingerprint()`。

指纹至少应包含：

- `segment.text`
- `segment.tts_overrides`
- 当前角色绑定的 `voice_preset_id`
- 声音预设快照内容
- 当前 `SynthesisConfig`
- `tts_backend`
- `tts_model_path`

说明：

- 只要以上任一项变化，该段就应被视为 `stale`
- 指纹写入 `Project.audio_assets.segments[segment_id].fingerprint`

### 4.4 归档格式 v2

建议保留现有导出路由，但把 ZIP 内容升级为如下结构：

```text
{project_id}.archive.zip
├── manifest.json
├── project/
│   └── project.json
├── audio/
│   ├── full/
│   │   ├── mix.wav
│   │   └── mix.mp3
│   └── segments/
│       ├── {segment_id}.wav
│       └── ...
├── subtitles/
│   ├── book.srt
│   └── book.lrc
└── voices/
    ├── presets.json
    └── ref/
        ├── *.wav
        ├── *.mp3
        └── ...
```

`manifest.json` 建议包含：

- `schema_version`
- `project_id`
- `project_name`
- `generated_at`
- `latest_tts_task_id`
- `audio_files`
- `subtitle_files`
- `segment_count`
- `preset_count`
- `has_reference_audio`

### 4.5 声音预设导入策略

当前声音预设是全局存储，不是项目内存储，因此导入时必须处理冲突。

推荐策略：

1. ZIP 中只导出“当前项目实际使用到的声音预设”
2. 导入时一律复制到本地全局预设池
3. 若 `preset.id` 冲突，生成新 ID
4. 若 `preset.name` 冲突，自动追加 ` (Imported)` 或短后缀
5. 更新导入项目中的 `voice_assignments`
6. 对 `ref_audio_path` 进行本地重写，指向导入后的参考音频路径

这样做的好处：

- 不破坏现有全局预设机制
- 不覆盖用户已有预设
- 项目依赖完整可恢复

### 4.6 分段重新生成工作流

局部合成不只是“重新生成几个 wav”，还必须维护整本结果和字幕。

推荐流程：

1. 前端提交 `project_id + segment_ids + config`
2. 后端载入项目与项目资产清单
3. 计算哪些段需要新生成
4. 对目标段重新执行 TTS
5. 非目标段优先复用 `Project.audio_assets`
6. 若某个未选中段缺少音频资产：
   - MVP 建议自动加入本次待生成列表
   - 并通过 WS 事件明确告知“已补齐缺失段”
7. 所有段就绪后重新混音
8. 重建整本字幕
9. 更新 `Project.audio_assets`
10. 推送 `complete`

### 4.7 局部合成与整本合成的关系

建议不要新造完全独立的第二套 TTS 管线，而是在现有整本合成逻辑上抽象“segment source resolver”：

- 整本合成：
  所有段都来自 `generate`
- 局部合成：
  目标段来自 `generate`
  非目标段来自 `reuse_existing`

这样可以最大程度复用当前 [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py) 的进度、混音、字幕和导出链路。

### 4.8 跨页面“待重新生成”同步机制

用户在 [frontend/src/pages/ScriptEditorPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/ScriptEditorPage.jsx) 做的修改，必须自然流入 [frontend/src/pages/SynthesisPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/SynthesisPage.jsx) 的“重新生成”工作流，而不是要求用户自己回忆改过哪些段。

建议把现有状态报告扩展为“状态 + 原因码”结构，例如：

```json
{
  "segment_id": "seg-1",
  "status": "stale",
  "reasons": ["text_changed", "tts_override_changed"]
}
```

推荐原因码：

- `text_changed`
- `tts_override_changed`
- `voice_assignment_changed`
- `preset_changed`
- `synthesis_config_changed`
- `missing_audio`

建议交互规则：

- `text_changed` / `tts_override_changed`：
  在合成页显示为“已修改待重新生成”，并默认加入勾选集合
- `voice_assignment_changed` / `preset_changed` / `synthesis_config_changed`：
  在合成页显示为“配置变化待重新生成”，默认仅标识，不强制勾选
- `missing_audio`：
  显示为“缺失音频”，默认加入勾选集合

这样可以满足“剧本编辑过的段在合成页有明显提示，必要时自动勾选”的要求，同时保持不同原因的可解释性。

### 4.9 合成页行内轻编辑

合成导出页不应只是结果浏览器，还要支持“边看边改边重新生成”的快捷闭环。

建议新增轻编辑模式：

- 每段支持展开行内编辑
- 字段范围尽量与剧本编辑页保持一致，至少包括：
  - `text`
  - `speaker`
  - `type`
  - `emotion`
  - `tts_overrides`
- 保存走与剧本编辑页相同的项目保存链路，不额外发明第二套接口语义
- 保存后该段立即变为“已修改待重新生成”，并默认勾选

为避免两页能力漂移，建议抽出共享段编辑组件，例如：

- `SegmentEditorPanel`
- `SegmentEditorForm`

由剧本编辑页和合成导出页共同复用，确保字段、校验和保存逻辑一致。

---

## 五、可执行实施计划

## Phase 0：项目资产层

### 0-A. 固定项目输出目录与路径工具

目标：

- 给每个项目建立稳定资产目录
- 统一路径生成方式，避免散落拼接

涉及文件：

- [backend/persistence.py](/E:/softs/BeautyVoiceTTS/backend/persistence.py)
- [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)

执行项：

1. 新增项目输出路径 helper
2. 新增 `segments/full/subtitles` 子目录 helper
3. 为现有导出接口切换到项目资产目录读取
4. 保留 task 目录，但只作为任务期中间态

交付物：

- 可复用的路径工具函数
- 项目级固定输出目录

验收标准：

- 同一个项目在刷新、重新进入页面后仍能找到最后一次的分段音频和整本音频

### 0-B. Project 模型扩展为资产可感知

目标：

- 项目 JSON 内能描述当前已有的分段资产和整本资产

涉及文件：

- [backend/models/project.py](/E:/softs/BeautyVoiceTTS/backend/models/project.py)

执行项：

1. 新增 `ProjectAudioAssets`
2. 新增 `SegmentAsset`
3. 扩展 `Project`
4. 补充老项目兼容默认值

交付物：

- 新的项目模型
- 老项目自动兼容读取

验收标准：

- 旧项目 JSON 不报错
- 新项目保存后自动带有 `audio_assets`

### 0-C. 项目资产写回逻辑

目标：

- 整本合成完成后，分段资产和整本资产写回项目状态

涉及文件：

- [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)

执行项：

1. 每段合成完成后写入 `SegmentAsset`
2. 整本混音完成后写入 full audio 与 subtitle 路径
3. 保存 `latest_task_id`
4. 保存每段指纹

验收标准：

- 合成完成后项目 JSON 中可见完整资产索引

---

## Phase 1：工程归档格式 v2

### 1-A. 导出 ZIP 升级为可回灌工程

目标：

- ZIP 不只是结果包，而是可导入工程包

涉及文件：

- [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)

执行项：

1. `manifest.json` 加 `schema_version=2`
2. 打包 `project/project.json`
3. 打包 `audio/full/*`
4. 打包 `audio/segments/*`
5. 打包 `subtitles/*`
6. 打包当前项目使用到的 `voices/presets.json`
7. 打包对应 `voices/ref/*`

验收标准：

- 导出 ZIP 解压后包含上述结构
- 不依赖当前本地路径即可理解包内容

### 1-B. 旧归档兼容设计

目标：

- 让未来导入器支持当前老版本 ZIP

执行项：

1. 若缺少 `schema_version`，按 v1 归档处理
2. 若缺少 `voices/presets.json`，允许导入但提示“声音快照缺失”
3. 若缺少 `audio/segments/*`，允许导入项目但标记需要重新生成

验收标准：

- v1 ZIP 不会因字段缺失直接失败

---

## Phase 2：工程导入与双入口接入

### 2-A. 后端导入接口

建议新增接口：

`POST /api/v1/projects/import/archive`

请求：

- `multipart/form-data`
- 文件字段：`file`

响应建议：

```json
{
  "project_id": "new-project-id",
  "project_name": "Imported Project",
  "imported_presets": 3,
  "imported_segments": 42,
  "has_full_audio": true,
  "warnings": []
}
```

涉及文件：

- [backend/api/project_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/project_routes.py)
- [backend/persistence.py](/E:/softs/BeautyVoiceTTS/backend/persistence.py)

执行项：

1. 上传 ZIP 到临时目录
2. 解压并校验 manifest
3. 读取 `project/project.json`
4. 为导入项目分配新 `project_id`
5. 导入分段音频、完整音频、字幕到项目资产目录
6. 导入预设快照与参考音频，并做 ID 重映射
7. 保存新项目
8. 返回导入结果

验收标准：

- 导入后项目可正常打开
- 导入后无需重新整本合成也能试听已有音频

### 2-B. 前端导入入口（文本输入页为主入口）

建议入口：

- 主入口放在 [frontend/src/pages/TextInputPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/TextInputPage.jsx)
- 用户在开始文本创作前，就能直接导入现有工程继续编辑
- 合成导出页保留快捷入口，形成工程进出闭环

涉及文件：

- [frontend/src/pages/TextInputPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/TextInputPage.jsx)
- [frontend/src/stores/useProjectStore.js](/E:/softs/BeautyVoiceTTS/frontend/src/stores/useProjectStore.js)

执行项：

1. 在文本输入页新增“导入工程 ZIP”主按钮
2. 上传 ZIP
3. 调用导入接口
4. 导入成功后自动切换到新项目
5. 显示 warning 列表
6. 导入成功后让文本输入区域、项目标题和后续跳转状态立即更新

验收标准：

- 用户不需要刷新页面即可看到导入结果
- 用户从文本输入页进入即可继续编辑导入工程

### 2-C. 合成导出页副入口

目标：

- 保留合成导出页导入入口，方便用户在结果页直接回灌别的工程对比或继续修改

涉及文件：

- [frontend/src/pages/SynthesisPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/SynthesisPage.jsx)
- [frontend/src/stores/useProjectStore.js](/E:/softs/BeautyVoiceTTS/frontend/src/stores/useProjectStore.js)

执行项：

1. 保留“导入工程 ZIP”快捷按钮
2. 与“下载完整工程 ZIP”相邻放置
3. 导入成功后刷新当前页的分段、整本音频和字幕状态

验收标准：

- 用户无论从文本输入页还是合成导出页进入，导入结果都一致

### 2-D. 导入后恢复策略

目标：

- 导入后各页面状态一致

执行项：

1. 文本输入页加载导入后的源文本与标题
2. 剧本页加载导入后的 `script`
3. 声音页加载 `voice_assignments` 与导入预设
4. 合成页加载已有 `segmentResults` 与整本音频链接
5. 若缺少分段资产，则标记“需重新生成”

验收标准：

- 四个主页面进入导入项目后状态正确

---

## Phase 3：分段重新生成 MVP 与合成页轻编辑

### 3-A. 后端局部合成接口

建议新增接口：

`POST /api/v1/tts/synthesize/segments`

请求草案：

```json
{
  "project_id": "xxx",
  "segment_ids": ["seg-1", "seg-5"],
  "config": {
    "num_step": 32,
    "guidance_scale": 2.0,
    "denoise": true,
    "gap_duration_ms": 500,
    "output_format": "wav"
  }
}
```

执行项：

1. 校验 `segment_ids`
2. 构建目标段集合
3. 对目标段执行 TTS
4. 对非目标段读取项目资产
5. 若某未选中段缺失，则自动补生成或报清晰错误
6. 重建整本音频和字幕
7. 更新项目资产清单

涉及文件：

- [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)
- [backend/models/api_models.py](/E:/softs/BeautyVoiceTTS/backend/models/api_models.py)

验收标准：

- 只修改 1 段时，不会整本全量重跑
- 结果中完整音频和字幕被自动更新

### 3-B. WebSocket 事件扩展

目标：

- 前端能明确知道这是“局部重新生成”

建议新增或扩展字段：

- `scope: "full" | "partial"`
- `target_segment_ids`
- `reused_count`
- `generated_count`

验收标准：

- 前端状态面板能显示“局部重新生成 2 段，复用 40 段”

### 3-C. 前端重新生成交互

建议第一阶段 UI：

1. 每段结果行新增“重新生成”按钮
2. 增加多选能力
3. 增加“选择段落重新生成”按钮，用于一键勾选当前“已修改待重新生成 / 缺失音频”的段
4. 增加“重新生成已选段落”执行按钮

涉及文件：

- [frontend/src/pages/SynthesisPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/SynthesisPage.jsx)
- [frontend/src/stores/useSynthesisStore.js](/E:/softs/BeautyVoiceTTS/frontend/src/stores/useSynthesisStore.js)

执行项：

1. 新增选中段状态
2. 新增 `startPartialSynthesis`
3. 复用现有任务通道
4. “选择段落重新生成”按钮自动同步推荐勾选集
5. 局部完成后仅替换对应 `segmentResults`
6. 更新整本下载链接

验收标准：

- 用户能对单段或多段发起重新生成
- 完成后新旧段结果正确合并显示

### 3-D. 合成页行内编辑

目标：

- 让用户无需切回剧本编辑页，也能在合成导出页快速修正某一段后直接重新生成

涉及文件：

- [frontend/src/pages/SynthesisPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/SynthesisPage.jsx)
- [frontend/src/pages/ScriptEditorPage.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/pages/ScriptEditorPage.jsx)
- [frontend/src/stores/useScriptStore.js](/E:/softs/BeautyVoiceTTS/frontend/src/stores/useScriptStore.js)

执行项：

1. 抽取共享段编辑组件
2. 在合成页每行增加“编辑”入口
3. 保存后同步项目数据
4. 保存后自动把当前段加入“待重新生成”集合
5. 用户再决定是仅重新生成该段，还是批量重新生成已选段

验收标准：

- 合成页可直接编辑单段
- 编辑后状态、勾选与重新生成入口保持一致

---

## Phase 4：已修改段识别、预勾选与体验打磨

### 4-A. 识别触发条件

以下任一变化，都将该段标为 `stale`：

- 段文本变化
- 段 `tts_overrides` 变化
- 角色绑定的声音预设变化
- 预设内容变化
- 合成参数变化
- TTS 后端或模型路径变化

### 4-B. UI 状态设计

建议在合成页为每段显示：

- `已同步`
- `已修改待重新生成`
- `配置变化待重新生成`
- `缺失音频`
- `正在生成`

建议在页面顶部显示：

- `共 42 段，其中 3 段已修改，2 段缺失`

建议默认勾选：

- 文本或 `tts_overrides` 被编辑过的段
- 缺失音频的段

### 4-C. 预勾选与选择策略

MVP 建议：

- 不自动后台重跑
- 仅显式提示并提供“选择段落重新生成”按钮
- 用户点按钮后，系统自动勾选当前推荐集合
- 真正执行动作仍由“重新生成已选段落”触发

后续增强可考虑：

- 保存剧本后自动把受影响段加入待处理列表
- 首次进入合成页时自动应用一次推荐勾选
- 对“文本修改”和“配置变化”提供不同颜色与图标

---

## 六、测试计划

### 后端测试

建议新增以下自动化覆盖：

1. 导出 ZIP 包含 v2 manifest、项目 JSON、分段音频、完整音频、字幕、预设快照、参考音频
2. 导入 ZIP 后生成新项目且项目 ID 重写成功
3. 导入时预设冲突会重映射，不覆盖已有预设
4. `stale-report` 能返回状态和原因码
5. 剧本文本变化后，相关段被判定为 `text_changed`
6. 局部合成仅更新目标段
7. 非目标段复用已有音频
8. 未选中段缺失时按设计自动补生成或返回清晰错误
9. 字幕和整本混音在局部合成后同步更新
10. 旧版 ZIP 兼容导入

### 前端测试

建议覆盖：

1. 文本输入页导入按钮上传成功与失败提示
2. 合成导出页副入口导入行为
3. 导入成功后自动切换项目
4. 单段“重新生成”按钮可用性
5. “选择段落重新生成”按钮的推荐勾选逻辑
6. 剧本编辑后，合成页段落标识或预勾选逻辑
7. 合成页行内编辑与保存后的状态联动
8. 局部合成完成后 UI 数据刷新

### 手工验收链路

1. 创建项目并完成一次整本合成
2. 导出完整工程 ZIP
3. 删除项目
4. 在文本输入页导入该 ZIP
5. 确认剧本、声音分配、分段音频、整本音频、字幕都恢复
6. 在剧本编辑页修改其中 1 段文本
7. 进入合成导出页，确认该段被标识为“已修改待重新生成”或已自动勾选
8. 点击“选择段落重新生成”，确认推荐集合正确
9. 点击“重新生成已选段落”
10. 确认其他段复用、整本音频和字幕更新
11. 在合成导出页直接编辑另一段并重新生成，确认闭环可用

---

## 七、风险与缓解

### 风险 1：全局声音预设与导入预设冲突

缓解：

- 导入时一律 ID 重映射
- 名称冲突自动加后缀

### 风险 2：旧项目没有任何项目级分段资产

缓解：

- 首次整本合成后补齐 `audio_assets`
- 导入旧 ZIP 时允许恢复项目，但标记“需重新生成”

### 风险 3：局部合成后整本混音与字幕不同步

缓解：

- 局部合成完成后必须统一走“重建 full audio + subtitles”流程
- 不允许只替换段 wav 而不更新整本导出

### 风险 4：导入包体积显著变大

缓解：

- 只导出当前项目实际使用到的预设与参考音频
- 后续可加“仅导出可编辑工程 / 仅导出结果包”双模式

### 风险 5：剧本编辑页与合成页编辑能力漂移

缓解：

- 抽共享段编辑组件
- 共用同一套保存与校验逻辑
- 在测试中覆盖两页对同一字段的展示与保存一致性

---

## 八、推荐实施顺序

1. 先做 `Phase 0`
2. 再做 `Phase 1`
3. 然后做 `Phase 2`
4. 再做 `Phase 3`
5. 最后做 `Phase 4`

原因：

- 没有项目资产层，就无法稳健导入，也无法可靠局部重新生成
- 没有可回灌 ZIP，导入功能只能做半成品
- 没有指纹与资产索引，重新生成推荐集合会不稳定

---

## 九、完成定义

当以下条件全部满足时，可认为本计划完成：

- 导出工程 ZIP 后可重新导入为新项目
- 导入后无需重新整本合成即可继续编辑与试听
- 文本输入页与合成导出页都可导入工程 ZIP
- 导入项目的声音分配与参考音频可恢复
- 剧本编辑页修改过的段在合成页有清晰标识或自动勾选
- 支持单段和多段重新生成
- 合成页支持行内编辑并进入重新生成闭环
- 局部重新生成后整本音频与字幕自动更新
- 系统可识别并显示需重新生成的段
- 后端与前端关键路径具备回归测试

---

## 十、建议的后续落地拆单

为了后续执行更顺畅，建议按以下顺序拆成独立任务单：

1. `P0-1` 项目资产目录与路径 helper
2. `P0-2` Project 模型增加 `audio_assets`
3. `P0-3` 整本合成写回项目资产
4. `P1-1` 工程 ZIP v2 导出
5. `P2-1` 工程 ZIP 导入接口
6. `P2-2` 文本输入页主入口与项目恢复
7. `P2-3` 合成导出页副入口与导入后状态刷新
8. `P3-1` 局部合成后端接口
9. `P3-2` 前端单段/多段“重新生成”与推荐勾选交互
10. `P3-3` 合成页共享段编辑器
11. `P4-1` 指纹、原因码与需重新生成识别
12. `P4-2` UI 标识、预勾选与测试补齐

本文件即为后续实施的主计划基线。
