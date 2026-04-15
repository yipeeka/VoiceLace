# BeautyVoiceTTS 预设导入去重实施方案

## 目标

解决“重复导入工程 ZIP 会不断新增声音预设，导致全局预设池快速膨胀”的问题。

本方案的核心原则是：

- 导入工程时，角色分配应优先匹配本地已有预设
- 只有在无法匹配时，才创建新的声音预设
- 参考音频也应优先复用，不应每次重复复制

---

## 一、问题定义

当前导入工程 ZIP 的行为偏向“直接复制导入”：

- ZIP 中包含的 `voices/presets.json` 会被逐项导入
- 即使本地已经存在等价预设，也会继续创建新预设
- 参考音频通常也会重新复制到本地

这会带来以下问题：

- 同一工程反复导入会生成大量重复预设
- 全局预设池迅速膨胀
- 角色分配越来越依赖“导入时生成的新 ID”
- 用户很难判断哪些预设是真正独立的，哪些只是重复副本

---

## 二、改造目标

导入工程 ZIP 时，声音预设处理改为“匹配优先、必要时新建”。

目标行为：

1. 如果 ZIP 中的预设与本地已有预设等价，则直接复用本地预设
2. 如果 ZIP 中的参考音频与本地已有参考音频相同，则直接复用本地文件
3. 只有无法匹配时，才创建新的预设和参考音频副本
4. 项目中的 `voice_assignments` 最终应指向“匹配后的本地预设 ID”

---

## 三、总体策略

建议把导入逻辑改为“三段式匹配 + 最后新建”。

### 3.1 匹配顺序

对 ZIP 中每个实际被项目使用到的预设，按以下顺序处理：

1. `ID 精确匹配`
2. `强指纹匹配`
3. `弱匹配`
4. `新建预设`

### 3.2 参考音频策略

参考音频不再每次无条件复制，而是：

1. 先计算文件内容哈希
2. 如果本地已存在相同哈希的参考音频，则直接复用
3. 仅在本地不存在时才复制新文件

---

## 四、预设匹配设计

## 4.1 第一步：ID 精确匹配

如果 ZIP 中的 `preset.id` 在本地存在：

- 若内容一致，直接复用该本地预设
- 若内容不一致，不直接复用，进入强指纹匹配

内容一致的判断建议基于“导入可比较字段”，而不是简单比较完整 JSON。

推荐比较字段：

- `voice_mode`
- `gender`
- `style`
- `description`
- `speed`
- 参考音频哈希
- 其他真正影响音色表现的字段

说明：

- `id`
- `name`
- `ref_audio_path`
- `created_at`
- 导入来源字段

这些不应作为“是否同一预设”的核心判断依据。

## 4.2 第二步：强指纹匹配

如果 ID 无法复用，则使用“预设语义指纹”匹配本地已有预设。

### 预设强指纹建议包含

- `voice_mode`
- `gender`
- `style`
- `description`
- `speed`
- 参考音频哈希
- 其他实际决定音色的稳定字段

### 不建议纳入强指纹的字段

- `id`
- `name`
- `ref_audio_path`
- 导入时间
- 来源项目 ID

### 结果处理

若本地存在相同强指纹的预设：

- 直接复用本地预设
- 不创建新预设
- 将工程中的角色分配映射到该本地预设 ID

## 4.3 第三步：弱匹配

如果没有强指纹命中，再进行弱匹配。

弱匹配建议条件：

- 同名
- 同 `voice_mode`
- 同 `gender`
- 同参考音频哈希

或更宽松的：

- 同名
- 同 `voice_mode`

说明：

- 弱匹配有误判风险，因此建议只在“智能复用模式”下自动采用
- 命中时应在导入结果中返回 warning，提示用户本次导入复用了近似匹配预设

示例 warning：

`已复用本地近似匹配预设：温柔女声（同名/同模式）`

## 4.4 第四步：新建预设

只有前三步都无法命中时，才创建新预设。

创建规则建议：

- 为其分配新的本地 `preset.id`
- 若名称冲突，自动追加后缀
- 参考音频若已复用本地文件，则直接写复用后的路径

---

## 五、参考音频去重设计

## 5.1 哈希策略

对 ZIP 中参考音频文件计算内容哈希，建议使用：

- `sha256`

哈希结果作为参考音频稳定身份。

## 5.2 复用规则

导入参考音频时：

1. 先扫描本地已有预设引用的参考音频
2. 建立 `audio_hash -> local_path` 映射
3. 若 ZIP 文件哈希已存在：
   - 直接复用该本地路径
   - 不复制文件
4. 若不存在：
   - 复制到 `voices_dir`
   - 写入新的本地路径

## 5.3 实现建议

建议新增工具函数：

- `compute_file_hash(path) -> str`
- `build_local_ref_audio_index() -> dict[str, str]`
- `resolve_imported_ref_audio(import_file) -> local_path`

---

## 六、导入流程改造

当前逻辑建议从“先导入预设，再回填角色”改为“按项目实际使用预设逐个匹配，再建立映射”。

推荐流程：

1. 解压 ZIP
2. 读取 `project/project.json`
3. 读取 `voices/presets.json`
4. 获取项目内实际使用到的 `voice_assignments`
5. 仅处理这些被使用到的 ZIP 预设
6. 对每个 ZIP 预设执行：
   - 解析参考音频
   - 计算参考音频哈希
   - 执行 `ID 匹配 -> 强指纹匹配 -> 弱匹配 -> 新建`
7. 建立映射表：
   - `archive_preset_id -> local_preset_id`
8. 使用该映射重写项目中的 `voice_assignments`
9. 保存导入后的项目

这样可以保证：

- 工程中的角色分配优先绑定到已有本地预设
- 没有使用到的 ZIP 预设不会污染本地全局池

---

## 七、建议新增的内部数据模型

本轮不一定需要改持久化模型，但建议在导入流程中引入以下运行时结构。

### 7.1 参考音频索引

```python
LocalRefAudioIndex = dict[str, str]
# key: sha256
# value: local_path
```

### 7.2 预设匹配结果

```python
class PresetMatchResult(BaseModel):
    archive_preset_id: str
    local_preset_id: str
    action: Literal["reused_by_id", "reused_by_fingerprint", "reused_by_weak_match", "created"]
    warning: str | None = None
```

### 7.3 预设语义指纹输入

```python
class PresetFingerprintPayload(BaseModel):
    voice_mode: str
    gender: str | None = None
    style: str | None = None
    description: str | None = None
    speed: float | None = None
    ref_audio_hash: str | None = None
```

---

## 八、建议新增工具函数

建议在导入逻辑附近增加以下 helper：

### 8.1 预设标准化

```python
def normalize_preset_for_match(preset: VoicePreset, ref_audio_hash: str | None) -> dict:
    ...
```

作用：

- 提取用于匹配的稳定字段
- 移除不应影响身份判断的字段

### 8.2 强指纹计算

```python
def build_preset_fingerprint(preset: VoicePreset, ref_audio_hash: str | None) -> str:
    ...
```

### 8.3 弱匹配键

```python
def build_preset_weak_key(preset: VoicePreset, ref_audio_hash: str | None) -> tuple:
    ...
```

### 8.4 单个 ZIP 预设匹配入口

```python
def resolve_imported_preset(
    imported_preset: VoicePreset,
    local_presets: list[VoicePreset],
    ref_audio_index: dict[str, str],
    imported_ref_dir: Path,
) -> PresetMatchResult:
    ...
```

---

## 九、导入模式设计

建议在导入接口层支持两种模式。

## 9.1 智能复用模式（推荐默认）

行为：

- 优先复用本地已有预设
- 优先复用本地已有参考音频
- 仅在无法匹配时新建

适用：

- 用户日常导入工程
- 避免全局预设池膨胀

## 9.2 完整隔离导入模式

行为：

- 总是创建新的预设副本
- 总是复制参考音频

适用：

- 想保留导入工程完全隔离
- 做试验或快照对比

建议默认模式：

- `smart_reuse`

---

## 十、导入结果返回设计

导入接口不应只返回 `warnings`，还应返回“预设与音频复用摘要”。

建议响应增加：

```json
{
  "project_id": "new-project-id",
  "project_name": "Imported Project",
  "imported_presets": 1,
  "reused_presets": 5,
  "created_presets": 1,
  "reused_ref_audios": 4,
  "copied_ref_audios": 1,
  "warnings": []
}
```

这样用户能直接看出：

- 这次导入复用了多少已有资源
- 是否生成了新的预设污染全局池

---

## 十一、兼容性要求

## 11.1 对老 ZIP 的兼容

如果 ZIP 中没有 `voices/presets.json`：

- 不报错
- 导入项目
- 返回 warning

如果 ZIP 中有预设但没有参考音频：

- 仍尝试按无参考音频模式匹配
- 若无法确认，则新建预设

## 11.2 对现有本地预设的兼容

现有本地预设可能没有：

- 参考音频哈希缓存
- 来源元数据

因此实现时应允许：

- 第一次导入时动态计算本地参考音频哈希
- 逐步建立索引

---

## 十二、建议实施顺序

### P0

1. 增加参考音频哈希工具
2. 增加预设标准化与强指纹计算
3. 在导入流程中实现“匹配优先”

### P1

4. 增加弱匹配与 warning 输出
5. 导入结果增加复用摘要字段
6. 前端导入结果展示“复用/新建”统计

### P2

7. 增加导入模式开关：`smart_reuse` / `isolated_import`
8. 为预设补充来源元数据字段

---

## 十三、测试计划

## 13.1 后端自动化测试

建议新增：

1. 同 ID 同内容预设导入时直接复用，不新建
2. 不同 ID 但相同强指纹预设导入时复用
3. 同名同模式弱匹配时复用并返回 warning
4. 无匹配时创建新预设
5. 相同参考音频哈希时不重复复制
6. 不同参考音频时复制新文件
7. 角色分配最终指向匹配后的本地预设 ID
8. 多次重复导入同一 ZIP，不应持续新增预设

## 13.2 手工验收

1. 清理到一个已知预设池状态
2. 导入同一个 ZIP 一次
3. 记录：
   - 新建预设数
   - 参考音频复制数
4. 再导入同一个 ZIP 第二次
5. 预期：
   - 不再新增等价预设
   - 不再重复复制相同参考音频
   - 角色分配保持正确

---

## 十四、完成定义

当满足以下条件时，可认为方案完成：

- 重复导入同一工程 ZIP 不再持续膨胀声音预设
- 角色分配优先绑定已有本地预设
- 相同参考音频不会重复复制
- 导入结果能明确告知“复用/新建”的统计
- 旧归档和旧本地预设仍可兼容导入

---

## 十五、结论

这个问题不应继续靠“名称冲突时改名”来缓解，而应从身份识别层修正：

- 预设身份应基于稳定语义指纹，而不是导入时临时生成的新 ID
- 参考音频身份应基于文件哈希，而不是导入后的路径
- 角色分配应指向匹配结果，而不是默认指向新建副本

推荐默认方案：

- 导入模式采用 `智能复用`
- 导入流程采用 `ID 匹配 -> 强指纹匹配 -> 弱匹配 -> 最后新建`
- 参考音频按哈希复用

这是当前最稳妥、最可控、也最符合长期维护成本的实现方向。
