# BeautyVoiceTTS 后端预生成波形 Peaks 实施方案

## 结论

是的，这对当前项目属于更优方案，而且是长期正确方向。

更准确地说：

- 对“波形渲染”这件事，后端预生成 `Peaks` 基本就是当前架构下的最优解
- 对“音频播放”这件事，前端仍然需要音频文件本身，但不再需要为了画波形去做整文件拉取和解码

这能直接解决当前项目里最明显的几个问题：

- 前端同时创建大量 `WaveSurfer` 实例，CPU 和内存压力大
- 分段列表中的多个小播放器并发解码，浏览器不稳定
- 临时 URL、加载时序、解码失败会导致“波形加载失败，已切换为基础播放器”
- 整书波形和段级波形都依赖浏览器端解码，页面越长越容易卡顿

当前代码里这类问题已经很明显：

- [frontend/src/components/shared/AudioPlayer.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/components/shared/AudioPlayer.jsx)
- [frontend/src/components/shared/SynthesisWaveSurfer.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/components/shared/SynthesisWaveSurfer.jsx)
- [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py)
- [backend/models/project.py](/E:/softs/BeautyVoiceTTS/backend/models/project.py)

所以推荐方案是：

- 后端在生成音频时同步计算 Peaks
- 段级小波形用“轻量级紧凑 Peaks”
- 完整音频波形用“多分辨率 Peaks”
- 前端只拿 Peaks 渲染，不再自己解码音频画波形
- 播放仍由原始音频 URL 负责

---

## 一、目标

把“波形显示”和“音频播放”彻底解耦。

目标效果：

1. 前端不再为了绘制波形去下载和解码整段音频
2. 合成完成时，段级波形和完整音频波形都已可直接展示
3. 页面刷新后仍能快速恢复波形，不依赖浏览器重新解码
4. 多段同时显示时保持稳定，不再频繁退回基础播放器
5. 波形缓存和音频资产一起持久化，可导出、可导入、可校验

---

## 二、为什么这是更优方案

## 2.1 当前方案的问题

当前前端波形依赖浏览器端解码：

- 段级列表里，一个页面可能同时出现几十个播放器
- 每个播放器都可能初始化 `WaveSurfer`
- `WaveSurfer` 为拿到波形，通常会加载音频并触发浏览器解码
- 一旦页面滚动、切换项目、刷新、编辑状态切换，就会反复初始化/销毁

这会带来：

- 浏览器主线程压力
- 音频解码压力
- 网络与缓存抖动
- 波形和播放状态不同步
- 个别音频可播放但波形实例初始化失败

## 2.2 Peaks 方案的优势

后端预生成 Peaks 后：

- 前端渲染波形只需要一小段数字数组
- 不再依赖浏览器端音频解码
- 小波形可以用 `canvas`/`svg` 自定义渲染，成本远低于 `WaveSurfer`
- 完整波形也可以使用预计算数据直接加载
- 页面打开速度和稳定性会明显提升

## 2.3 这不是“只优化一点点”，而是架构级优化

它不是单纯的前端微调，而是把波形的计算职责放到正确的位置：

- 音频生成发生在后端
- 音频文件在后端最容易拿到原始 PCM
- 波形本质上是音频的派生数据
- 派生数据最适合在后端一次生成、重复复用

---

## 三、核心设计原则

1. 波形数据是音频资产的派生物，不是前端临时产物
2. Peaks 必须和对应音频文件绑定，并受同一份指纹/缓存控制
3. 段级列表和完整音频采用不同粒度的 Peaks，不强行共用一份
4. 前端波形渲染尽量脱离 `WaveSurfer` 的解码职责
5. 本方案只面向新的音频资产生成链路，不纳入历史兼容要求

---

## 四、推荐架构

## 4.1 段级小波形

适用于“合成导出 -> 分段时间线”的每一行播放器。

推荐：

- 每段生成一份紧凑 Peaks
- 点数建议 `64`、`96` 或 `128` bins
- 数据格式建议为 `min/max` 对，而不是单值平均

原因：

- 段级播放器宽度很小，不需要太高精度
- `min/max` 能保留爆点和停顿，视觉上比平均值更真实
- 体积很小，甚至可以直接走 WS 事件内联传输

## 4.2 完整音频波形

适用于“完整音频”区域的大波形、时间轴、缩放。

推荐：

- 生成多分辨率 Peaks
- 至少保存三档：
  - `overview`: 512 或 1024 bins
  - `medium`: 2048 bins
  - `detail`: 4096 或 8192 bins

原因：

- 完整音频需要缩放
- 单一分辨率既不能兼顾总览，也不能兼顾细节
- 多分辨率能避免前端缩放时仍需重新解码

---

## 五、后端数据模型改造

推荐在 [backend/models/project.py](/E:/softs/BeautyVoiceTTS/backend/models/project.py) 中扩展音频资产结构。

## 5.1 SegmentAsset 新增字段

建议新增：

```python
peaks_relpath: str | None = None
peaks_version: int = 1
peaks_bins: int = 0
peaks_format: Literal["minmax_i16"] = "minmax_i16"
audio_sha256: str = ""
```

用途：

- `peaks_relpath`: 指向该段对应的 peaks JSON 文件
- `peaks_version`: 以后内部格式升级时可区分版本
- `peaks_bins`: 当前 peaks 点数
- `peaks_format`: 明确数据编码方式
- `audio_sha256`: 绑定音频内容，便于校验 Peaks 是否过期

## 5.2 ProjectAudioAssets 新增字段

建议新增：

```python
full_peaks_relpath: str | None = None
full_peaks_version: int = 1
full_peaks_levels: list[int] = Field(default_factory=list)
```

用途：

- 保存完整音频波形数据位置
- 标记多分辨率层级

## 5.3 归档版本

如果工程 ZIP 需要同步携带 Peaks，建议把 `archive_schema_version` 提升到 `3`。

本计划只定义新结构，不纳入旧版归档兼容要求。

---

## 六、文件存储设计

建议在输出目录内新增波形数据目录：

```text
backend/data/output/projects/{project_id}/waveforms/
backend/data/output/projects/{project_id}/waveforms/full.peaks.json
backend/data/output/projects/{project_id}/waveforms/segments/{segment_id}.peaks.json
```

推荐不要把大数组直接塞进 `project.json`：

- 会让项目文件膨胀
- 每次保存项目都会改大文件
- 不利于导入导出和增量更新

推荐做法：

- 项目 JSON 只保存 relpath 和元信息
- Peaks 主体存成 sidecar JSON 文件

---

## 七、Peaks 数据格式

## 7.1 推荐格式

段级和完整音频统一使用：

```json
{
  "version": 1,
  "format": "minmax_i16",
  "duration_ms": 6123,
  "sample_rate": 24000,
  "channels": 1,
  "bins": 128,
  "levels": {
    "128": [-120, 340, -180, 520, ...]
  }
}
```

完整音频可扩展为：

```json
{
  "version": 1,
  "format": "minmax_i16",
  "duration_ms": 125381,
  "sample_rate": 24000,
  "channels": 1,
  "levels": {
    "1024": [...],
    "2048": [...],
    "4096": [...]
  }
}
```

## 7.2 为什么建议 `minmax_i16`

优点：

- 数据体积小
- 直接反映峰值
- 渲染简单
- 能保留瞬时冲击，不会“太平”

不建议：

- 只存平均振幅
- 直接存大段浮点 PCM

---

## 八、Peaks 生成算法

## 8.1 生成时机

推荐在 [backend/api/tts_routes.py](/E:/softs/BeautyVoiceTTS/backend/api/tts_routes.py) 的合成流程里做两处同步生成：

1. 每段 `segment.wav` 生成完并落盘后，立即生成该段 Peaks
2. 完整音频 `mix.wav` 生成完并落盘后，立即生成完整音频 Peaks

这里的“同步”是指：

- 同属于当前 TTS 后台任务的一部分
- 在返回 `segment_done` / `complete` 前完成

而不是指：

- 阻塞主 Web 请求线程

因为当前合成本来就在后台任务里运行，这样做是合适的。

## 8.2 算法步骤

以单声道 WAV 为主：

1. 打开音频文件
2. 分块读取 PCM
3. 若多声道则转单声道
4. 按目标 bins 切分时间窗口
5. 每个窗口求：
   - `min(sample)`
   - `max(sample)`
6. 结果量化为 `int16`
7. 写入 Peaks JSON

## 8.3 多分辨率生成

完整音频在一次扫描中同时生成多档 levels：

- `1024`
- `2048`
- `4096`

这样可以避免重复扫描音频文件多次。

---

## 九、后端 API 设计

## 9.1 段级 Peaks 接口

建议新增：

```text
GET /api/v1/tts/projects/{project_id}/segments/{segment_id}/peaks
```

返回：

```json
{
  "segment_id": "...",
  "audio_url": "/api/v1/tts/projects/{project_id}/segments/{segment_id}/audio",
  "duration_ms": 6123,
  "peaks_url": "/api/v1/tts/projects/{project_id}/segments/{segment_id}/peaks",
  "format": "minmax_i16",
  "bins": 128,
  "data": [...]
}
```

也可以更轻量：

- 直接返回 peaks 文件内容
- `audio_url` 由前端继续从项目数据中拿

## 9.2 完整音频 Peaks 接口

建议新增：

```text
GET /api/v1/tts/projects/{project_id}/waveform
```

支持参数：

```text
?level=1024
?level=2048
?level=4096
```

返回：

```json
{
  "project_id": "...",
  "duration_ms": 125381,
  "format": "minmax_i16",
  "level": 2048,
  "data": [...]
}
```

## 9.3 WebSocket 事件增强

对于段级行播放器，推荐在 `segment_done` 事件中直接附带紧凑 Peaks：

```json
{
  "type": "segment_done",
  "segment_id": "...",
  "duration_ms": 6123,
  "audio_url": "...",
  "peaks": {
    "format": "minmax_i16",
    "bins": 96,
    "data": [...]
  }
}
```

这样好处是：

- 合成完成的段能立即显示波形
- 前端无需再单独发一次请求

完整音频波形不建议走 WS 内联：

- 数据更大
- 适合走专门接口按需拉取

---

## 十、前端改造方案

## 10.1 行级播放器

建议把 [frontend/src/components/shared/AudioPlayer.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/components/shared/AudioPlayer.jsx) 改成“两层模式”：

1. 播放层：继续使用 `<audio>` 或单独音频控制
2. 波形层：用 Peaks 数据自己画

推荐不再让行级小播放器继续依赖 `WaveSurfer`。

原因：

- 行级播放器需求其实很简单
- 只需要：
  - 播放/暂停
  - 当前时间
  - 一条小波形
- 完全没有必要为每一行都启一个重型波形实例

推荐实现：

- 新增 `CompactWaveform.jsx`
- 使用 `canvas` 或 `svg`
- 输入：
  - `peaks`
  - `duration`
  - `currentTime`
  - `height`

## 10.2 完整音频波形

对于 [frontend/src/components/shared/SynthesisWaveSurfer.jsx](/E:/softs/BeautyVoiceTTS/frontend/src/components/shared/SynthesisWaveSurfer.jsx)：

可选两条路：

### 路线 A：继续用 WaveSurfer，但改为加载预计算 Peaks

优点：

- 保留现有缩放、时间轴、regions 生态
- 改动成本相对较低

要求：

- 确认当前项目使用的 `wavesurfer.js` 版本对“外部 peaks + duration”加载方式的具体 API
- 实现时校验签名后接入

### 路线 B：自绘完整波形

优点：

- 完全摆脱 WaveSurfer 解码和内部状态复杂度
- 可控性最高

代价：

- 需要自己实现：
  - 缩放
  - 时间轴
  - 选区/高亮
  - 点击定位

推荐结论：

- 行级播放器走自绘
- 完整音频先走“WaveSurfer + 预计算 Peaks”
- 后面若还不稳定，再考虑完整迁移到自绘

---

## 十一、与现有缓存/指纹体系的整合

当前项目已经有：

- `fingerprint`
- `source_*`
- `audio_relpath`

这非常适合继续扩展 Peaks。

推荐规则：

1. 只要音频内容变了，Peaks 必须重新生成
2. Peaks 文件名可直接与音频资产绑定
3. 读取 Peaks 时先校验：
   - 文件存在
   - `audio_sha256` 匹配
   - `duration_ms` 一致

这样可以避免：

- 剧本改了但波形没更新
- 复用缓存音频时 Peaks 指向旧文件

---

## 十二、导入导出设计

## 12.1 工程导出 ZIP

建议在归档导出时同时带上：

```text
audio/full/mix.wav
audio/segments/{segment}.wav
waveforms/full.peaks.json
waveforms/segments/{segment}.peaks.json
```

## 12.2 工程导入 ZIP

导入时：

- 若归档中包含 Peaks 文件且音频匹配，则直接恢复
- 若当前归档结构要求带 Peaks，则按新结构严格校验

这样：

- 新归档可以秒开波形
- 系统内导出再导入时结构保持一致

---

## 十三、推荐实施顺序

## Phase 1：后端能力落地

1. 新增 Peaks 生成工具模块
2. 扩展 `SegmentAsset` / `ProjectAudioAssets`
3. 在 TTS 任务中生成并持久化段级 Peaks
4. 在完整音频导出后生成 full Peaks
5. 新增段级和完整音频 Peaks 接口

完成标准：

- 合成完成后磁盘中可看到 `.peaks.json`
- 项目 JSON 中已有 relpath 和元信息

## Phase 2：段级播放器改造

1. 新增 `CompactWaveform.jsx`
2. `AudioPlayer.jsx` 改为“音频播放 + Peaks 渲染”
3. 列表播放器彻底不再依赖前端音频解码来画波形
4. `segment_done` 事件可附带紧凑 peaks

完成标准：

- 分段列表里的波形不再依赖 `WaveSurfer`
- 同页多段显示稳定

## Phase 3：完整音频波形改造

1. 完整音频页面改为从 `/waveform?level=...` 拉取 peaks
2. 保留现有 regions/time axis 体验
3. 接入缩放时的多分辨率切换

完成标准：

- 打开完整音频区域时不再触发整文件前端解码
- 缩放与时间轴可正常工作

## Phase 4：导入导出打通

1. ZIP 导出包含 peaks
2. ZIP 导入恢复 peaks
3. 工程内导出/导入链路校验通过

---

## 十四、测试计划

## 15.1 后端测试

建议新增：

1. 单段合成后生成 peaks 文件
2. 完整音频导出后生成 full peaks 文件
3. 删除 peaks 文件时接口返回正确错误
4. 音频变更后 peaks 指纹更新
5. ZIP 导出包含 peaks
6. ZIP 导入后恢复 peaks relpath

## 15.2 前端测试

建议新增：

1. 段级播放器在仅有 peaks 时正常渲染
2. 波形渲染不依赖浏览器解码
3. 完整音频波形按 level 正确切换
4. peaks 缺失时降级逻辑清晰可控

## 14.3 手工验收

1. 打开一个包含 30+ 段的项目
2. 合成导出页面首次打开应快速出现波形
3. 页面刷新后波形应快速恢复
4. 浏览器任务管理器中 CPU 峰值应明显低于当前方案
5. 多段不再频繁出现“波形加载失败”

---

## 十五、风险与注意事项

## 16.1 不要把大 peaks 数组直接塞进 WebSocket 全量状态

段级紧凑 peaks 可走 WS。

完整音频大 peaks 不建议走 WS。

否则：

- 消息过大
- 重连同步成本高

## 16.2 不要把全部 peaks 内联进 project.json

否则：

- 项目保存会很重
- 读写开销大
- 导入导出不灵活

## 16.3 Peaks 必须和音频一起失效

不能只更新音频不更新 Peaks。

否则前端会显示错波形。

## 16.4 行级播放器应优先做轻量化

这一块收益最大。

因为当前最容易出问题的不是完整音频区域，而是几十个小播放器同时出现的分段列表。

---

## 十六、最终建议

推荐采用，而且推荐尽快做。

如果要一句话总结：

> 对 BeautyVoiceTTS 当前这套“多段播放器 + 完整音频波形 + WebSocket 进度”的架构来说，后端预生成 Peaks 不是可选优化，而是下一步最值得做的稳定性和性能升级。

建议落地策略：

1. 先做后端 Peaks 持久化与接口
2. 再替换段级小播放器
3. 最后升级完整音频波形

这条路线风险最低、收益最大，也最符合你现在项目已经暴露出来的问题结构。
