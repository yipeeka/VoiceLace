# VoiceLace 详细实施计划 v2 (基于 v1 深度审阅后修订)

本文档是对 `implementation_plan01.md` 的全面审阅成果。在保留 v1 核心方向的基础上，通过逐行走查全部后端引擎、API 路由、前端 Store 和页面组件源码，补充了 v1 **遗漏的关键缺陷**、纠正了优先级排序中的逻辑错误、并新增了多个可独立交付的改进项。

## User Review Required

> [!IMPORTANT]
> 本计划是对 v1 的升级修订版，主要变更：
> 1. **新增 Phase 0**：修复当前代码中已存在的 bug 和断裂点（不属于功能增强，属于必修补丁）。
> 2. **重排优先级**：将 v1 的 2-C（参数挂载）降级，因为当前 `SynthesisConfig` 的 `num_step` / `guidance_scale` 本已传入但 `tts_engine.py` 根本没读它——要修的不是前端传参，而是后端 `synthesize_to_file` 忽略了 config。
> 3. **新增 6 个 v1 未覆盖的改进子项**（标注为 `[NEW]`）。
> 4. **删除 v1 中部分冗余或过早优化的条目**（在各处注明理由）。

---

## Phase 0: 现有 Bug 修复与断裂闭合 `[NEW]`

> [!CAUTION]
> 以下问题在当前代码中已经存在，不是功能增强，而是"再不修就影响基本使用"的 bug。在任何新功能之前必须先清理。

### 0-A. `tts_engine.py` 不消费 `SynthesisConfig` [P0] `[NEW]`

**问题**：`tts_routes.py` L63 将 `config` 从请求中取出并挂到 `project.synthesis_config`，但 L100 调用 `synthesize_to_file(text, path, preset)` 时**没有传 config**。`TTSEngine.synthesize_to_file()` 的签名也没有 `config` 参数。这意味着前端 `SynthesisPage` 上的 `num_step`、`guidance_scale`、`denoise` 滑块**全是摆设**。

**修复**：
1. 给 `TTSEngine.synthesize_to_file()` 加 `config: SynthesisConfig | None = None` 参数。
2. 在 OmniVoice 真实调用 `self._model.generate(**kwargs)` 时，把 `num_step` → `generate(steps=...)` / `guidance_scale` → `generate(cfg_scale=...)` 映射进去（需对照 OmniVoice API 文档确认参数名）。
3. `tts_routes.py` L100 传入 `config`。

> [!NOTE]
> v1 把这归为 "Phase 2 子项 2-C: OmniVoice 参数深度挂载"，但它根本不是增强，是一个接线断裂 bug。提升到 Phase 0。

---

### 0-B. `model_orchestrator.py` GPU 信息硬编码假数据 [P0] `[NEW]`

**问题**：`get_gpu_info()` 直接 `return asdict(GpuInfo())`，返回 `device_name="demo-device"`、`total_vram_mb=0`、`used_vram_mb=0`。这导致前端 `StatusBar` 和 `SettingsPage` 显示的 VRAM 数值**永远是 0/0**。

**修复**：
```python
def get_gpu_info(self) -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            dev = torch.cuda.current_device()
            total = torch.cuda.get_device_properties(dev).total_mem
            used = torch.cuda.memory_allocated(dev)
            return asdict(GpuInfo(
                device_name=torch.cuda.get_device_name(dev),
                total_vram_mb=int(total / 1024 / 1024),
                used_vram_mb=int(used / 1024 / 1024),
                free_vram_mb=int((total - used) / 1024 / 1024),
            ))
    except Exception:
        pass
    return asdict(GpuInfo())
```

> [!NOTE]
> v1 把这归到 Phase 1 子项 1-C 下面，但这是一行代码的修复，没必要放那么后面。

---

### 0-C. `upload-ref` 只支持 WAV 格式获取时长 [P1] `[NEW]`

**问题**：`voice_routes.py` L53-58 用 `wave.open()` 获取时长，如果上传的是 MP3/FLAC/OGG，`wave.open` 会失败，`duration` 返回 0。

**修复**：用 `pydub.AudioSegment` 或 `mutagen` 获取任意格式时长，`wave` 作为 fallback。

---

### 0-D. `preview` 端点覆盖同一个文件 [P1] `[NEW]`

**问题**：`voice_routes.py` L82 硬编码输出到 `state.settings.output_dir / "preview.wav"`。如果两个用户/浏览器 Tab 同时预览，音频会互相覆盖。

**修复**：用 `f"preview_{uuid4().hex[:8]}.wav"` 命名，定期清理超过 10 分钟的 preview 文件。

---

### 0-E. 前端 `SettingsPage` API 路径不匹配 [P0] `[NEW]`

**问题**：前端 `useSettingsStore.js` 调用：
- `GET /system/orchestrator/config` — 后端无此端点
- `POST /system/orchestrator/config` — 后端只有 `PUT`

后端实际是：
- `GET /system/status` — 返回包含 `config` 字段的完整状态
- `PUT /system/orchestrator/config` — 更新配置

**修复**：
1. `loadOrchestratorConfig` 改为从 `GET /system/status` 的 `.config` 字段提取。
2. `saveOrchestratorConfig` 改为 `PUT` 方法。

---

### 0-F. `useSynthesisStore` 的 `reset()` 缺失 [P1] `[NEW]`

**问题**：`SynthesisPage` 在 `handleStart` 中调用 `reset()`，但 `useSynthesisStore` 没有定义该 action，会静默失败（undefined 调用不报错但不清理旧状态）。

**修复**：在 store 中添加：
```js
reset: () => set({
  taskId: null, status: "idle", modelStatus: "",
  progress: { current: 0, total: 0 },
  segmentResults: {}, fullAudioUrl: null,
  isRunning: false, error: "",
}),
```

---

## Phase 1: 核心引擎性能（保留 v1 方向，细化实施）

### 1-A. LLM 分块解析 [P0]

v1 的设计基本完备，补充以下关键实施细节：

#### 分块算法补充

```
原始方案：按空行/段落切分 → 二次按 1500-2500 字切分
```

**优化**：不应在句中切断对话。改为：
1. 第一刀：以连续空行为边界，拆为"段落组"。
2. 第二刀：对超出 `max_chunk_chars`（默认 2000）的段落组，在最后一个完整段落的 `\n` 处切开（而不是硬切字符数）。
3. 保证每个 chunk 是以完整的台词或段落结尾的。

#### 上下文传递 Schema

```python
@dataclass
class ChunkContext:
    chunk_index: int
    total_chunks: int
    known_characters: dict[str, str]   # name → description
    last_speaker: str                  # 前一 chunk 最后说话的人
    narrative_state: str               # "正在打斗" / "回忆场景" 等摘要
```

注入方式：将 `known_characters` 序列化为 Prompt 导言：
```
已知角色：
- 林黛玉：多愁善感的年轻女性，说话温柔
- 贾宝玉：率真的少年，说话直率
```

#### WebSocket 进度扩展

当前 LLM WebSocket 只有模糊的 `progress.percent`。分块后改为：
```json
{"type": "chunk_progress", "chunk": 3, "total_chunks": 12, "percent": 25}
```

#### 新增文件
- `backend/engine/text_chunker.py` — 分块器
- `backend/engine/chunk_merger.py` — 结果合并器

#### 改造文件
- `llm_engine.py` — `parse_text_stream` 改为 `parse_text_chunked_stream`
- `llm_routes.py` — `_run_parse_task` 中调用新入口

---

### 1-B. TTS 增量缓存 [P0]

v1 设计完备。以下是精确的改造路径：

#### 缓存键

```python
import hashlib, json

def segment_cache_key(text: str, preset_id: str, config: SynthesisConfig, engine_version: str) -> str:
    blob = json.dumps({
        "text": text,
        "preset_id": preset_id,
        "num_step": config.num_step,
        "guidance_scale": config.guidance_scale,
        "denoise": config.denoise,
        "engine": engine_version,
    }, sort_keys=True)
    return hashlib.md5(blob.encode()).hexdigest()
```

#### 改造点

在 `tts_routes.py` 的 `_run_synthesis_task` 循环中：
```python
# 伪代码
cache_key = segment_cache_key(segment.text, preset_id, config, engine_backend)
cached_path = cache_dir / f"{cache_key}.wav"
if cached_path.exists():
    # 直接复制到 segment_path，emit segment_done (cached)
else:
    await tts_engine.synthesize_to_file(...)
    shutil.copy(segment_path, cached_path)
```

#### 前端显示

合成启动时先快速扫描缓存命中率，WebSocket 新增：
```json
{"type": "cache_scan", "total": 45, "cached": 38, "to_generate": 7}
```

---

### 1-C. 真实 GPU 监控 [P1]

**已在 0-B 中修复基础部分**。本子项扩展为：
1. 后端新增 `/system/gpu-realtime` WebSocket 端点，每 5 秒推送 GPU 状态。
2. 前端 `StatusBar` 改为订阅该 WebSocket（取代目前 8 秒轮询 REST），减少请求量。
3. 当 VRAM 使用率 >85% 时，StatusBar 显示橙色警告；>93% 显示红色并 Toast 提示"显存即将耗尽"。

---

## Phase 2: 音频管线增强

### 2-A. Mixer Engine [P1]

v1 设计方向正确。精确改造路径：

#### 新建 `backend/engine/mixer_engine.py`

```python
class MixerEngine:
    def mix_segments(
        self,
        segment_paths: list[Path],
        gap_ms: int = 500,
        crossfade_ms: int = 30,
        normalize: bool = True,
        target_sample_rate: int = 24000,
    ) -> tuple[AudioSegment, list[TimelineEntry]]:
        ...
```

#### `TimelineEntry` 数据结构

```python
@dataclass
class TimelineEntry:
    segment_id: str
    speaker: str
    text: str
    start_ms: int
    end_ms: int
    duration_ms: int
```

#### 字幕生成

Timeline → SRT/LRC 转换独立为 `backend/engine/subtitle_gen.py`：
```python
def timeline_to_srt(entries: list[TimelineEntry]) -> str: ...
def timeline_to_lrc(entries: list[TimelineEntry]) -> str: ...
```

#### 改造 `tts_routes.py`

替换当前 L71-L136 的手动 `combined_frames.extend()` 逻辑，改为：
```python
timeline = mixer.mix_segments(segment_paths, gap_ms=config.gap_duration_ms)
```

---

### 2-B. ZIP 导出 [P1]

v1 设计完备，补充端点设计：

#### 后端新增

```python
@router.get("/export/{project_id}/archive")
async def export_archive(project_id: str, state=Depends(get_app_state)):
    """返回包含完整音频、分段、字幕和元信息的 ZIP 文件"""
```

#### 前端

在 `SynthesisPage` 合成完成后的操作区增加"📦 下载完整工程"按钮。

---

### 2-C. OmniVoice 参数挂载

> [!NOTE]
> **v1 将此列为第一个开发项并标为 P0。实际情况是：Phase 0-A 已修复了接线问题（传 config 给 engine），此处只剩精确映射参数到 `model.generate()` 的实际调用参数名。降为 P1，合并进 0-A 的验证环节。**

---

## Phase 3: 前端体验升级

### 3-A. 连续分段播放 [P2]

v1 设计完备。技术方案：

在 `SynthesisPage` 中引入一个播放队列 hook：
```js
const { currentIdx, isAutoPlay, play, stop, onSegmentEnd } = usePlaybackQueue(segments);
```

`AudioPlayer` 增加 `onEnded` 回调 prop，段结束时触发 `onSegmentEnd()` 自动前进。

---

### 3-B. WebSocket 断线重连 [P1]

v1 设计完备。精确方案：

新建 `frontend/src/hooks/useReconnectingWebSocket.js`：

```js
export function useReconnectingWebSocket(url, {
  maxRetries = 5,
  baseDelay = 1000,      // 指数退避
  onMessage,
  onReconnect,           // 重连成功后回调（用于重新拉取 REST 状态）
}) { ... }
```

改造 `useScriptStore` 和 `useSynthesisStore` 中的 WebSocket 使用，替换为此 hook。

---

### 3-C. 项目删除功能 `[NEW]` [P1]

**v1 完全遗漏**。当前无法删除项目，用户创建测试项目后列表会越来越长。

**改造**：
- 后端 `project_routes.py`：`DELETE /projects/{project_id}` — 删除 JSON 文件 + 事件日志 + 输出音频。
- 前端 `TextInputPage`：项目选择器旁增加删除按钮 + `ConfirmDialog`。

---

### 3-D. 预设编辑功能 `[NEW]` [P1]

**v1 完全遗漏**。后端已有 `PUT /voices/presets/{preset_id}`，但前端 `VoiceConfigPage` 只有创建和删除，无法编辑已有预设的属性。

**改造**：
- 点击预设卡片时，将预设数据填入表单（而不仅仅是高亮选中）。
- 表单底部的按钮改为"创建预设" / "更新预设"动态切换。
- `useVoiceStore` 增加 `updatePreset` action。

---

## 建议开发顺序（修订后）

```
Phase 0 (先修 bug，1-2 天)
  0-A  tts_engine 不消费 config
  0-B  GPU 假数据
  0-E  SettingsPage API 路径
  0-F  useSynthesisStore.reset 缺失
  0-C  upload-ref 多格式时长
  0-D  preview 文件覆盖

Phase 1 (核心引擎，3-5 天)
  1-B  TTS 增量缓存
  1-A  LLM 分块解析
  1-C  GPU WebSocket 实时推送

Phase 2 (音频管线，2-3 天)
  2-A  Mixer Engine + 字幕生成
  2-B  ZIP 导出

Phase 3 (体验打磨，2-3 天)
  3-C  项目删除
  3-D  预设编辑
  3-B  WebSocket 断线重连
  3-A  连续分段播放
```

> [!IMPORTANT]
> **与 v1 最大的区别**：v1 建议先做 2-C（参数挂载），本版本识别出那其实是一个 bug 修复（0-A），并将其提到 Phase 0 第一个完成。同时新增了 v1 遗漏的 6 个实际问题（0-B ~ 0-F, 3-C, 3-D）。

---

## 验收矩阵（修订后）

| Milestone | 包含子项 | 核心验收标准 |
|-----------|---------|-------------|
| **M0: Bug-Free Baseline** | 0-A ~ 0-F | SettingsPage 显示真实 GPU 数据；合成参数生效；预设能编辑；预览不冲突 |
| **M1: Smart Synthesis** | 1-B, 1-C | 修改 1 段后重合成 < 10 秒（而非全量重跑）；VRAM 实时可见 |
| **M2: Long Text** | 1-A | 10 万字文本可分块解析完成；角色无明显漂移 |
| **M3: Pro Export** | 2-A, 2-B | 导出 ZIP 含完整音频 + 分段 + SRT/LRC；无爆音；音量均匀 |
| **M4: Polish** | 3-A ~ 3-D | 项目可删除；预设可编辑；试听可连续播放；断线可恢复 |

---

## 风险与应对（修订后）

| 风险 | 严重度 | 应对策略 |
|------|-------|---------|
| OmniVoice `generate()` 参数名与预期不符 | **高** | 0-A 修复时需对照 OmniVoice 源码确认，无法查到则仅传 `text`+`instruct`+`ref_audio`+`speed`，其余参数标记为"待适配" |
| 分块解析角色漂移 | 中 | 引入 `ChunkContext.known_characters` + 后处理名称归一化 |
| 缓存误命中 | 中 | Cache key 包含 engine version + 全部推理参数；提供手动清缓存按钮 |
| `pydub` 依赖 ffmpeg | 中 | 在 `requirements.txt` 注明；Mixer 无 pydub 时降级为当前字节拼接 |
| 长文本 WebSocket 超时 | 低 | 分块模式下每块独立超时，不再需要 20 分钟全局超时 |

