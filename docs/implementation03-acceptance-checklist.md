# implementation_plan03 真实验收清单

本清单用于对照 `implementation_plan03.md` 做逐项验收。建议按“自动化 -> 手工链路”顺序执行。

## A. 功能验收

- [ ] 文本输入页可导入工程 ZIP（主入口）
- [ ] 合成导出页可导入工程 ZIP（副入口）
- [ ] 导入后项目自动切换，无需刷新页面
- [ ] 导入 warning 在页面中可见（不只 toast）
- [ ] 剧本编辑后，合成导出页能显示“已修改待重新生成/配置变化待重新生成/缺失音频”
- [ ] 合成导出页支持“选择段落重新生成”
- [ ] 合成导出页支持“重新生成已选段落”
- [ ] 合成导出页单行支持“重新生成”
- [ ] 合成导出页每行支持编辑并保存
- [ ] 行内编辑支持 `text/speaker/type/emotion/non_verbal/tts_overrides`
- [ ] `tts_overrides` 非法 JSON 时会阻止保存并提示
- [ ] 分段播放在 `done/stale` 状态可用，`missing` 状态不可用

## B. 接口验收

Base URL: `http://localhost:8000/api/v1`

- [ ] `POST /projects/import/archive` 可导入 v2 归档
- [ ] `POST /projects/import/archive` 可兼容导入 v1 常见归档
- [ ] `POST /tts/synthesize/segments` 能局部重建并返回任务 ID
- [ ] `GET /tts/projects/{project_id}/stale-report` 返回 `items[].reasons`
- [ ] `GET /tts/projects/{project_id}/segments/{segment_id}/audio` 可读取项目级分段音频

## C. 自动化回归

### 后端

```powershell
E:\softs\BeautyVoiceTTS\.venv\Scripts\python.exe -m unittest backend.tests.test_api_smoke backend.tests.test_task_flows backend.tests.test_persistence
```

- [ ] 全部通过
- [ ] `test_import_archive_v1_layout_supported` 通过
- [ ] `test_stale_report_marks_missing_and_stale_segments` 通过

### 前端

```powershell
cd E:\softs\BeautyVoiceTTS\frontend
npm test
```

- [ ] 全部通过
- [ ] `tests/stale.test.mjs` 通过
- [ ] `tests/segmentDraft.test.mjs` 通过

## D. 手工验收链路

1. 创建项目并整本合成一次，导出完整工程 ZIP。
2. 删除该项目。
3. 在文本输入页导入刚导出的 ZIP。
4. 检查：文本、剧本、声音分配、分段音频、整本音频、字幕是否恢复。
5. 在剧本编辑页修改 1 段文本并保存。
6. 进入合成导出页，检查该段是否被标识为“已修改待重新生成”（或被推荐勾选）。
7. 点击“选择段落重新生成”后，确认推荐勾选集合符合预期。
8. 点击“重新生成已选段落”执行局部任务。
9. 检查：仅目标段重建，其余段复用；整本音频与字幕自动更新。
10. 在合成导出页直接编辑另一段并重新生成，确认闭环可用。

- [ ] 手工链路全通过

## E. 记录模板

建议验收记录：

- 版本/分支：
- 验收日期：
- 验收人：
- 后端自动化结果：
- 前端自动化结果：
- 手工链路结果：
- 发现问题与修复单：
