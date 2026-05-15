# Project Save/Open 手工验收清单

## 0. 目标

验证以下能力已经按 `project-save-open-plan.md` 落地：

- 文本输入页可保存轻量项目文件（`.bvtproject.json`）
- 文本输入页可打开轻量项目文件
- 剧本编辑页可在存在草稿改动时保存项目文件（以草稿为准）
- 打开轻量项目文件后，文本/剧本/角色分配/合成配置恢复，音频资产不伪恢复

## 1. 前置条件

- 后端服务已启动（默认 `http://127.0.0.1:8000`）
- 前端服务已启动
- 能正常进入「文本输入」和「剧本编辑」页面

可选回归命令：

```powershell
E:\softs\VoiceLace\.venv\Scripts\pythonw.exe -m unittest backend.tests.test_api_smoke backend.tests.test_task_flows backend.tests.test_persistence
cd E:\softs\VoiceLace\frontend
npm test
```

## 2. 文本输入页：未解析文本保存/打开

1. 进入「文本输入」页，不创建项目或创建空项目均可。
2. 在文本框输入一段新文本（不要点解析）。
3. 点击「保存项目」。
4. 预期：
   - 浏览器下载一个 `*.bvtproject.json` 文件。
   - 文件中 `script.source_text` 为当前文本框内容。
5. 清空文本框或刷新页面。
6. 点击「打开项目文件」，选择上一步导出的文件。
7. 预期：
   - 自动创建/切换到一个 `(Imported)` 项目。
   - 文本输入框恢复刚才内容。

## 3. 剧本编辑页：草稿优先保存

1. 先完成一次解析并进入「剧本编辑」页。
2. 对剧本做至少两类改动（不要先点“保存剧本”）：
   - 修改某段文本
   - 新增或删除某段
3. 确认操作区显示「有未保存改动」。
4. 直接点击「保存项目」。
5. 预期：
   - 下载 `*.bvtproject.json`
   - 文件内 `script.segments` 包含刚才的草稿改动
6. 重新打开该项目文件（文本输入页「打开项目文件」）。
7. 预期：
   - 导入后的项目中，剧本内容与保存时草稿一致。

## 4. 语义区分：打开项目文件 vs 导入工程 ZIP

1. 文本输入页分别执行：
   - 「打开项目文件」（轻量 json）
   - 「导入工程 ZIP」
2. 预期：
   - 两个按钮文案和入口同时存在，不混淆。
   - 打开项目文件成功提示为“项目文件打开完成”。
   - 导入工程 ZIP 成功提示为“工程导入完成”。

## 5. 音频资产不伪恢复

1. 打开一个轻量项目文件导入后的 `(Imported)` 项目。
2. 调用接口检查：

```powershell
curl "http://127.0.0.1:8000/api/v1/projects/<imported_project_id>"
```

3. 预期字段：
   - `audio_assets.full_wav_relpath == null`
   - `audio_assets.full_mp3_relpath == null`
   - `audio_assets.segments == {}`

## 6. 后端接口抽查

1. 导出接口：

```powershell
curl "http://127.0.0.1:8000/api/v1/projects/<project_id>/export/project-file"
```

2. 预期：
   - HTTP 200
   - Header: `X-BVT-Project-File: 1`
   - JSON 包含 `file_type=beautyvoice_project`、`schema_version=1`

3. 导入接口（可用 Postman 或前端按钮）：
   - `POST /api/v1/projects/import/project-file`
4. 预期：
   - 返回 `project_id`
   - 新项目名称后缀为 `(Imported)`

## 7. 通过标准

以下全部满足即验收通过：

- 未解析文本可保存并恢复
- 剧本编辑草稿可保存并恢复
- 打开项目文件与导入 ZIP 语义清晰
- 轻量导入后不错误显示音频资产已恢复
- 后端导入/导出接口返回结构符合预期
