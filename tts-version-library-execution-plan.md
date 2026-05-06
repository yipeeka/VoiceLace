# TTS 合成版本库详细执行计划

## 1. 背景与目标

当前项目的 TTS 合成产物保存在 `ProjectAudioAssets` 的当前资产字段中：

- `full_wav_relpath`
- `full_mp3_relpath`
- `subtitle_srt_relpath`
- `subtitle_lrc_relpath`
- `segments`
- `full_peaks_relpath`
- `processed`

现有行为是后一次整本合成会覆盖当前 raw 音频资产。目标是升级为项目内“合成版本库”：

- 同一项目可保留不同 TTS 后端、参数、声音预设组合生成的多套产物。
- 用户可 A/B 对比多个版本。
- 用户可一键把某个完整版本设为当前导出版本。
- 用户可逐段选择使用哪个版本的音频，并重建当前整轨。
- 默认每个项目最多保留 5 套版本。

首版仍保持现有工作流体验：合成完成后会自动更新当前音频，但旧版本不丢失。

## 2. 产品规则

### 2.1 版本类型

每次合成完成后都创建一个 `AudioVersion`。

- 整本合成：版本包含完整分段音频、整轨、字幕、整轨 peaks。
- 局部合成：版本至少包含本次目标段的候选音频。完成后默认把目标段切换到该版本，并重建当前整轨。

### 2.2 当前版本与逐段选择

项目有两个选择状态：

- `active_version_id`：当前完整版本。用于表达“整本来自某个版本”。
- `active_segment_versions`：每段实际采用的版本映射。用于混用不同版本。

规则：

- 设完整版本为当前时，将该版本内可用的所有段写入 `active_segment_versions`。
- 逐段选择版本时，只更新指定段的映射。
- 当前播放、当前导出、后期处理输入都基于 `active_segment_versions` 重建后的当前 raw 混音。
- A/B 试听指定版本不会修改当前选择。

### 2.3 保留策略

默认每个项目最多保留 5 套版本。

自动清理规则：

- 新版本写入后检查版本数。
- 删除最老的、没有被 `active_version_id` 或 `active_segment_versions` 引用的版本。
- 如果所有超额版本都被引用，不自动删除，并在前端显示需要手动整理的提示。
- 删除版本时，如果版本仍被当前选择引用，后端拒绝删除。

### 2.4 后期处理关系

首版版本库只管理 raw TTS 合成产物。

- `processed` 后期产物仍属于“当前 raw 混音”的派生产物。
- 当当前 raw 混音因版本切换或逐段切换而重建时，清空或标记 `processed` 过期，避免后期音频和当前 raw 不一致。
- 后期处理任务仍读取当前 raw 整轨。

## 3. 数据模型设计

### 3.1 新增模型

在 `backend/models/project.py` 增加以下模型。

```python
class AudioVersionSegmentAsset(BaseModel):
    segment_id: str
    audio_relpath: str
    duration_ms: int = 0
    fingerprint: str = ""
    source_text: str = ""
    source_speaker: str = ""
    source_type: str = ""
    source_emotion: str = ""
    source_tts_overrides: dict = Field(default_factory=dict)
    source_voice_preset_id: str | None = None
    source_preset_hash: str = ""
    source_config_hash: str = ""
    source_tts_backend: str = ""
    source_tts_model_path: str = ""
    source_task_id: str | None = None
    created_at: str = ""
    status: Literal["ready", "missing", "stale"] = "ready"
    peaks_relpath: str | None = None
    peaks_version: int = 1
    peaks_bins: int = 0
    peaks_format: Literal["minmax_i16"] = "minmax_i16"
    audio_sha256: str = ""


class AudioVersion(BaseModel):
    id: str
    name: str
    created_at: str
    source_task_id: str
    kind: Literal["full", "partial"] = "full"
    tts_backend: str = ""
    tts_model_path: str = ""
    config_hash: str = ""
    config_snapshot: dict = Field(default_factory=dict)
    voice_assignments_snapshot: dict[str, str] = Field(default_factory=dict)
    preset_hashes: dict[str, str] = Field(default_factory=dict)
    segment_count: int = 0
    available_segment_ids: list[str] = Field(default_factory=list)
    full_wav_relpath: str | None = None
    full_mp3_relpath: str | None = None
    subtitle_srt_relpath: str | None = None
    subtitle_lrc_relpath: str | None = None
    full_peaks_relpath: str | None = None
    segments: dict[str, AudioVersionSegmentAsset] = Field(default_factory=dict)
```

`AudioVersionSegmentAsset` 可以复用 `SegmentAsset`，但建议单独定义别名或子模型，方便后续版本库字段独立演进。

### 3.2 扩展 ProjectAudioAssets

```python
class ProjectAudioAssets(BaseModel):
    latest_task_id: str | None = None
    full_wav_relpath: str | None = None
    full_mp3_relpath: str | None = None
    subtitle_srt_relpath: str | None = None
    subtitle_lrc_relpath: str | None = None
    segments: dict[str, SegmentAsset] = Field(default_factory=dict)
    full_peaks_relpath: str | None = None
    full_peaks_version: int = 1
    full_peaks_levels: list[int] = Field(default_factory=list)
    archive_schema_version: int = 4
    processed: ProcessedAudioAssets = Field(default_factory=ProcessedAudioAssets)

    versions: dict[str, AudioVersion] = Field(default_factory=dict)
    active_version_id: str | None = None
    active_segment_versions: dict[str, str] = Field(default_factory=dict)
    version_retention_limit: int = 5
```

兼容策略：

- 旧项目缺少 `versions` 时自动为空。
- 首次打开旧项目且存在当前 raw 音频时，可通过迁移服务生成一个 `legacy-current` 版本。
- 当前资产字段继续存在，作为激活混音的兼容投影。

## 4. 文件路径设计

### 4.1 新增路径 helper

在 `backend/services/tts_path_service.py` 增加：

```python
def project_versions_dir(output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "versions"


def project_version_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_versions_dir(output_dir=output_dir, project_id=project_id) / version_id


def project_version_segments_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_version_dir(output_dir, project_id, version_id) / "segments"


def project_version_full_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_version_dir(output_dir, project_id, version_id) / "full"


def project_version_waveforms_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_version_dir(output_dir, project_id, version_id) / "waveforms"


def project_version_segment_waveforms_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_version_waveforms_dir(output_dir, project_id, version_id) / "segments"


def project_version_subtitles_dir(output_dir: Path, project_id: str, version_id: str) -> Path:
    return project_version_dir(output_dir, project_id, version_id) / "subtitles"
```

### 4.2 目录结构

```text
backend/data/output/projects/{project_id}/
  versions/
    {version_id}/
      segments/
        {segment_id}.wav
      full/
        mix.wav
        mix.mp3
      subtitles/
        book.srt
        book.lrc
      waveforms/
        full.peaks.json
        segments/
          {segment_id}.peaks.json
  full/
    mix.wav
    mix.mp3
  segments/
    {segment_id}.wav
  subtitles/
    book.srt
    book.lrc
  waveforms/
    full.peaks.json
    segments/
      {segment_id}.peaks.json
```

`versions/*` 是版本库源资产；现有 `full/segments/subtitles/waveforms` 是当前激活混音投影。

## 5. 后端服务拆分

### 5.1 新增版本服务

新增 `backend/services/tts_version_service.py`。

职责：

- `ensure_legacy_audio_version(project, output_dir)`  
  为旧项目当前资产创建 legacy 版本。

- `create_audio_version_from_task(...)`  
  根据合成任务产物创建 `AudioVersion`，复制或移动音频到版本目录。

- `activate_audio_version(project, version_id, output_dir)`  
  将完整版本设为当前，更新 `active_version_id` 和 `active_segment_versions`，然后重建当前混音。

- `update_segment_version_selection(project, selection, output_dir)`  
  批量更新段级版本选择，然后重建当前混音。

- `rebuild_active_audio_assets(project, output_dir, config)`  
  逐段读取 `active_segment_versions` 对应资产，生成当前 `full/segments/subtitles/waveforms`。

- `prune_audio_versions(project, output_dir, limit=5)`  
  执行最多 5 套版本的清理策略。

- `delete_audio_version(project, version_id, output_dir)`  
  删除未被引用的版本和磁盘目录。

### 5.2 当前混音重建规则

`rebuild_active_audio_assets` 的输入：

- `project.script.segments`
- `project.audio_assets.versions`
- `project.audio_assets.active_segment_versions`
- `project.synthesis_config.gap_duration_ms`

重建步骤：

1. 按剧本顺序遍历 segment。
2. 读取该 segment 对应的 `version_id`。
3. 在对应 version 的 `segments` 中找到音频。
4. 复制到当前 `projects/{project_id}/segments/{segment_id}.wav`。
5. 重建当前段 peaks。
6. 用 `MixerEngine.mix_segments` 生成当前 `full/mix.wav`。
7. 按当前混音 timeline 生成 `book.srt` 和 `book.lrc`。
8. 生成当前 full peaks。
9. 更新兼容字段：
   - `audio_assets.segments`
   - `full_wav_relpath`
   - `full_mp3_relpath`
   - `subtitle_srt_relpath`
   - `subtitle_lrc_relpath`
   - `full_peaks_relpath`
10. 清空或标记 `audio_assets.processed` 过期。

缺失规则：

- 如果某段没有可用版本音频，保留该段为 missing，不阻止其他段。
- 如果重建整轨时存在 missing 段，仍可生成仅包含可用段的整轨，但 stale report 需显示缺音频。
- 如果所有段都缺失，返回错误。

## 6. 合成任务链路改造

### 6.1 整本合成

当前流程：

1. 生成每段音频到 task 临时目录。
2. 复制到项目当前 `segments`。
3. 重建当前 `full/mix.wav`。
4. 覆盖 `ProjectAudioAssets`。

改造后：

1. 创建 `version_id`，建议格式：`v-{yyyyMMdd-HHmmss}-{backend}-{short_task_id}`。
2. 每段音频写入 `versions/{version_id}/segments`。
3. 每段 peaks 写入 `versions/{version_id}/waveforms/segments`。
4. 整轨、字幕、full peaks 写入 `versions/{version_id}` 下对应目录。
5. 创建 `AudioVersion(kind="full")`。
6. 写入 `audio_assets.versions[version_id]`。
7. 自动 `activate_audio_version(version_id)`，将它投影为当前 raw。
8. 执行版本清理。
9. 事件日志追加：
   - `tts_version_created`
   - `tts_version_activated`
   - `tts_versions_pruned`，如发生清理。

### 6.2 局部合成

当前局部流程会更新目标段并按需要重建当前整轨。

改造后：

1. 创建 `AudioVersion(kind="partial")`。
2. 仅保存目标段候选音频到版本目录。
3. 写入 `available_segment_ids`。
4. 默认将本次目标段写入 `active_segment_versions[segment_id] = version_id`。
5. 调用 `rebuild_active_audio_assets` 重建当前 raw。
6. 执行版本清理。

注意：

- 局部版本没有完整 `full_wav_relpath` 时，前端不能作为“整本版本”一键设为当前。
- 局部版本可作为段级候选使用。

### 6.3 缓存复用

现有 `cache/tts/{fingerprint}.wav` 保留。

- 缓存命中仍可复制到版本目录。
- 版本库不替代缓存。缓存用于避免重复生成，版本库用于保留用户可见产物。

## 7. API 设计

### 7.1 列出版本

`GET /api/v1/tts/projects/{project_id}/versions`

响应：

```json
{
  "project_id": "xxx",
  "active_version_id": "v-...",
  "active_segment_versions": {
    "segment-1": "v-a",
    "segment-2": "v-b"
  },
  "retention_limit": 5,
  "needs_manual_cleanup": false,
  "versions": [
    {
      "id": "v-...",
      "name": "OmniVoice 2026-05-06 14:30",
      "kind": "full",
      "created_at": "2026-05-06T12:30:00Z",
      "tts_backend": "omnivoice",
      "segment_count": 42,
      "available_segment_count": 42,
      "is_active_version": true,
      "used_segment_count": 42,
      "can_activate": true,
      "can_delete": false,
      "audio_url": "/api/v1/tts/export?project_id=xxx&format=wav&version_id=v-..."
    }
  ],
  "segment_candidates": {
    "segment-1": [
      {
        "version_id": "v-a",
        "version_name": "OmniVoice 2026-05-06 14:30",
        "tts_backend": "omnivoice",
        "duration_ms": 1200,
        "is_selected": true,
        "audio_url": "/api/v1/tts/projects/xxx/segments/segment-1/audio?version_id=v-a"
      }
    ]
  }
}
```

### 7.2 激活完整版本

`POST /api/v1/tts/projects/{project_id}/versions/{version_id}/activate`

行为：

- 仅允许 `kind="full"` 且覆盖所有当前剧本段的版本激活为完整版本。
- 更新 `active_version_id`。
- 重写 `active_segment_versions`。
- 重建当前 raw 混音。
- 返回更新后的 project 或版本状态摘要。

### 7.3 逐段选择版本

`PUT /api/v1/tts/projects/{project_id}/segment-version-selection`

请求：

```json
{
  "selection": {
    "segment-1": "v-a",
    "segment-2": "v-b"
  }
}
```

行为：

- 校验每个 version 中存在对应 segment 音频。
- 更新 `active_segment_versions`。
- 如果混用了多个版本，`active_version_id` 保留但前端显示“混合版本”。
- 重建当前 raw 混音。

### 7.4 删除版本

`DELETE /api/v1/tts/projects/{project_id}/versions/{version_id}`

行为：

- 如果版本被 `active_version_id` 引用，拒绝。
- 如果版本被 `active_segment_versions` 任意段引用，拒绝。
- 删除模型记录和磁盘目录。
- 写事件日志。

### 7.5 指定版本试听/导出

扩展现有接口，增加 `version_id` query。

- `GET /api/v1/tts/export?project_id=...&format=wav&version_id=...`
- `GET /api/v1/tts/projects/{project_id}/waveform?version_id=...`
- `GET /api/v1/tts/projects/{project_id}/segments/{segment_id}/audio?version_id=...`
- `GET /api/v1/tts/projects/{project_id}/segments/{segment_id}/peaks?version_id=...`

规则：

- 不传 `version_id`：返回当前激活混音。
- 传 `version_id`：返回指定版本资产，用于 A/B 试听和下载。
- `variant=processed` 仍只支持当前激活混音的后期产物。

## 8. 前端改造

### 8.1 Store

在 `useSynthesisStore` 增加：

- `audioVersions`
- `activeVersionId`
- `activeSegmentVersions`
- `segmentVersionCandidates`
- `needsManualVersionCleanup`
- `loadAudioVersions(projectId)`
- `activateAudioVersion(projectId, versionId)`
- `updateSegmentVersionSelection(projectId, selection)`
- `deleteAudioVersion(projectId, versionId)`

合成完成后：

- 刷新当前项目。
- 刷新版本库。
- 当前播放器指向重建后的当前 raw。

### 8.2 版本库卡片

新增 `SynthesisVersionLibraryCard`。

位置：

- 合成页任务状态卡附近，建议在“任务状态”下方或与任务状态同列。

内容：

- 当前状态：当前完整版本或“混合版本”。
- 版本列表：
  - 名称
  - 后端
  - 生成时间
  - 段数
  - 当前使用段数
  - 试听
  - 设为当前
  - 下载
  - 删除
- 空状态：尚无版本，提示先开始合成。
- 超额状态：显示“版本已达上限，部分版本被当前段选择引用，需要手动整理”。

### 8.3 分段时间线

在 `SegmentTimelineRow` 增加版本选择入口。

首版 UI：

- 每段显示一个小按钮或下拉：“版本”。
- 打开后列出该段所有候选版本。
- 每个候选显示：
  - 版本名
  - 后端
  - 时长
  - 是否当前选中
  - 试听
  - 使用此版本

交互：

- 试听只播放候选段音频，不改变当前选择。
- 使用此版本调用 `PUT /segment-version-selection`，只提交该段映射。
- 成功后刷新当前项目、版本库、stale report 和播放器。

### 8.4 当前音频与 A/B 试听

当前播放器仍播放当前激活混音。

版本 A/B 可通过：

- 版本库卡片里的版本试听链接。
- 段级候选里的段音频试听。

首版不需要做双播放器对齐播放，避免复杂度过高。

## 9. README 更新

在 README 的合成导出部分更新说明：

- OmniVoice/VoxCPM2 多次合成会进入版本库，不再直接丢失旧产物。
- 当前播放/导出来自“当前版本”或“混合版本”。
- 可在版本库中设为当前版本。
- 可在分段时间线中逐段选择候选版本。
- 默认最多保留 5 套版本。
- 后期处理基于当前 raw 混音生成。

## 10. 测试计划

### 10.1 后端单测

新增 `backend/tests/test_tts_version_service.py`。

覆盖：

- 旧项目 legacy version 迁移。
- 整本版本创建并激活。
- 局部版本创建并更新目标段选择。
- 混合段版本后重建当前整轨。
- 版本删除引用保护。
- 5 套版本自动清理。
- 指定 `version_id` 导出整轨、分段音频、peaks。
- 当前 raw 重建后 `processed` 被清空或标记过期。

扩展现有测试：

- `test_tts_query_service.py`
- `test_tts_delivery_service.py`
- `test_tts_path_service.py`
- `test_tts_finalize_service.py`
- `test_tts_pipeline_service.py`，如已有。

### 10.2 前端测试

重点手测与可自动化测试：

- 合成一次后版本库出现版本，并自动成为当前版本。
- 再用另一个后端或参数合成，旧版本仍存在。
- 点击“设为当前”后播放器和下载链接切换。
- 单段选择旧版本后，页面显示混合版本。
- 删除当前引用版本时按钮禁用或后端拒绝。
- 超过 5 套版本时清理未引用旧版本。

### 10.3 回归流程

完整回归：

1. 文本解析。
2. 剧本编辑并保存。
3. 声音配置。
4. OmniVoice 整本合成。
5. VoxCPM2 整本合成。
6. 版本库 A/B 试听。
7. 将版本 A 设为当前。
8. 某几段选择版本 B。
9. 当前混音重建。
10. 后期处理。
11. 导出 raw、processed、工程 ZIP。

## 11. 实施阶段

### Phase 1: 后端版本库基础

- 增加模型字段。
- 增加路径 helper。
- 增加 `tts_version_service.py`。
- 实现 legacy 迁移、版本创建、激活、逐段选择、重建当前混音、保留清理。
- 增加基础单测。

验收：

- 通过后端服务单测。
- 不改前端时旧项目仍能合成、播放、导出。

### Phase 2: 合成链路接入

- 整本合成写入完整版本并激活。
- 局部合成写入候选版本并默认切换目标段。
- 保持现有 task event 和前端完成状态兼容。
- 更新 stale report 读取当前激活资产。

验收：

- 连续合成两次后旧版本仍在项目 JSON 中。
- 当前播放/导出仍与最后一次合成结果一致。

### Phase 3: API 接入

- 增加版本列表、激活、逐段选择、删除接口。
- 扩展导出、波形、分段音频接口的 `version_id`。
- 增加 API 单测。

验收：

- Postman 或 curl 可完成版本切换和逐段切换。
- 指定版本试听不影响当前资产。

### Phase 4: 前端版本库

- 增加版本 store 方法。
- 增加 `SynthesisVersionLibraryCard`。
- 分段时间线增加版本选择入口。
- 合成完成后刷新版本库。
- 当前播放器保持播放激活混音。

验收：

- 页面可完成完整 A/B 对比、设为当前、逐段混用。
- 前端 `npm run build` 通过。

### Phase 5: 文档与归档

- README 更新版本库说明。
- 工程 ZIP 导出包含 `versions` 目录与版本元数据。
- 工程 ZIP 导入恢复版本库。

验收：

- 导出再导入后版本库仍可用。
- README 与实际 UI 一致。

## 12. 风险与处理

- 磁盘占用增大：通过 5 套版本保留策略控制。
- 混合版本导致后期产物过期：切换后清空或标记 processed 过期。
- 旧项目兼容：保留当前资产字段，并提供 legacy version 自动迁移。
- 局部版本不可整本激活：前端禁用“设为当前”，后端校验拒绝。
- 当前 `stale-report` 仍基于 `audio_assets.segments`：保持重建当前投影后继续兼容。

## 13. 验收标准

- 同一项目连续合成 2 次，旧音频版本不丢失。
- 可把任意完整版本设为当前播放/导出版本。
- 可对单个片段选择不同版本，并重建当前整轨。
- 默认最多保留 5 套版本，未引用旧版本自动清理。
- 当前 raw 切换后，后期处理不会误用旧 raw 的 processed 产物。
- 旧项目无需手动迁移即可继续播放、合成、导出。
