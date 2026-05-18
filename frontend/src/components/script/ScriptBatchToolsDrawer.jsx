import { Blend, PencilLine, Replace, Settings2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent } from "../ui/Dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import Select from "../ui/Select";
import Button from "../ui/Button";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";

function buildSearchPreview({ segments, find, replace, caseSensitive }) {
  if (!find) return { hitCount: 0, affectedCount: 0, rows: [] };
  let pattern;
  try {
    pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch {
    return { hitCount: 0, affectedCount: 0, rows: [] };
  }

  let hitCount = 0;
  const rows = [];
  for (const segment of segments || []) {
    const text = String(segment?.text || "");
    const matches = text.match(pattern);
    if (!matches?.length) continue;
    hitCount += matches.length;
    const replaced = text.replace(pattern, replace || "");
    rows.push({
      segmentId: segment.id,
      before: text,
      after: replaced,
      hit: matches.length,
    });
  }
  return {
    hitCount,
    affectedCount: rows.length,
    rows: rows.slice(0, 5),
  };
}

export default function ScriptBatchToolsDrawer({
  open,
  onOpenChange,
  characters = [],
  visibleSegments = [],
  activeSpeakerFilter = "all",
  canExecute = true,
  isSaving = false,
  onRenameCharacter,
  onMergeCharacter,
  onBatchUpdate,
  onSearchReplace,
}) {
  const [tab, setTab] = useState("rename");
  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [mergeSourceName, setMergeSourceName] = useState("");
  const [mergeTargetName, setMergeTargetName] = useState("");
  const [fromEmotion, setFromEmotion] = useState("");
  const [targetEmotion, setTargetEmotion] = useState("");
  const [fromType, setFromType] = useState("");
  const [targetType, setTargetType] = useState("");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const characterOptions = useMemo(
    () => (characters || []).map((item) => ({ value: item.name, label: `${item.name} (${item.count}段)` })),
    [characters]
  );

  const scopeText = `作用范围：角色=${activeSpeakerFilter === "all" ? "全部" : activeSpeakerFilter} · 共 ${visibleSegments.length} 段`;

  const renamePreviewCount = useMemo(
    () => (visibleSegments || []).filter((seg) => (seg?.speaker || "").trim() === fromName).length,
    [visibleSegments, fromName]
  );
  const mergePreviewCount = useMemo(
    () => (visibleSegments || []).filter((seg) => (seg?.speaker || "").trim() === mergeSourceName).length,
    [visibleSegments, mergeSourceName]
  );
  const emotionOptionsInScope = useMemo(() => {
    const existing = new Set((visibleSegments || []).map((seg) => (seg?.emotion || "neutral")));
    const ordered = EMOTION_OPTIONS.filter((opt) => existing.has(opt.value));
    return ordered.length ? ordered : [{ value: "neutral", label: "neutral（中性）" }];
  }, [visibleSegments]);

  const typeOptionsInScope = useMemo(() => {
    const existing = new Set((visibleSegments || []).map((seg) => (seg?.type || "dialogue")));
    const ordered = TYPE_OPTIONS.filter((opt) => existing.has(opt.value));
    return ordered.length ? ordered : [{ value: "dialogue", label: "对话 (dialogue)" }];
  }, [visibleSegments]);

  useEffect(() => {
    const emotionValues = new Set(emotionOptionsInScope.map((opt) => opt.value));
    const typeValues = new Set(typeOptionsInScope.map((opt) => opt.value));
    if (fromEmotion && !emotionValues.has(fromEmotion)) setFromEmotion("");
    if (fromType && !typeValues.has(fromType)) setFromType("");
  }, [emotionOptionsInScope, typeOptionsInScope, fromEmotion, fromType]);

  const batchSourceMatches = useMemo(() => {
    return (visibleSegments || []).filter((seg) => {
      const segEmotion = seg?.emotion || "neutral";
      const segType = seg?.type || "dialogue";
      if (fromEmotion && segEmotion !== fromEmotion) return false;
      if (fromType && segType !== fromType) return false;
      return true;
    });
  }, [visibleSegments, fromEmotion, fromType]);

  const batchCandidates = useMemo(() => {
    return (batchSourceMatches || []).filter((seg) => {
      const segEmotion = seg?.emotion || "neutral";
      const segType = seg?.type || "dialogue";
      const willChangeEmotion = Boolean(targetEmotion) && segEmotion !== targetEmotion;
      const willChangeType = Boolean(targetType) && segType !== targetType;
      return willChangeEmotion || willChangeType;
    });
  }, [batchSourceMatches, targetEmotion, targetType]);
  const batchPreviewCount = (targetEmotion || targetType) ? batchCandidates.length : batchSourceMatches.length;
  const searchPreview = useMemo(
    () =>
      buildSearchPreview({
        segments: visibleSegments,
        find: findText,
        replace: replaceText,
        caseSensitive,
      }),
    [visibleSegments, findText, replaceText, caseSensitive]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="批量工具"
        description={scopeText}
        className="batchToolsDrawer"
      >
        {!canExecute ? (
          <div className="statusBadge warning" style={{ marginBottom: 10, display: "block", textAlign: "left" }}>
            当前有未保存草稿，请先保存后再执行后端批量操作。
          </div>
        ) : null}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="batchTabsList">
            <TabsTrigger value="rename"><PencilLine aria-hidden="true" focusable="false" size={13} /> 角色改名</TabsTrigger>
            <TabsTrigger value="merge"><Blend aria-hidden="true" focusable="false" size={13} /> 角色合并</TabsTrigger>
            <TabsTrigger value="batch"><Settings2 aria-hidden="true" focusable="false" size={13} /> 批量属性</TabsTrigger>
            <TabsTrigger value="replace"><Replace aria-hidden="true" focusable="false" size={13} /> 搜索替换</TabsTrigger>
            <TabsTrigger value="structure"><UsersRound aria-hidden="true" focusable="false" size={13} /> 片段结构</TabsTrigger>
          </TabsList>

          <TabsContent value="rename">
            <div className="listStack">
              <Select aria-label="源角色" value={fromName} onValueChange={setFromName} options={characterOptions} placeholder="选择源角色…" />
              <input
                className="textInput"
                name="renameTarget"
                aria-label="新角色名"
                autoComplete="off"
                spellCheck={false}
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder="输入新角色名…"
              />
              <div className="muted">预览影响：{renamePreviewCount} 段</div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !fromName || !toName || fromName === toName || renamePreviewCount <= 0}
                  onClick={() => onRenameCharacter?.({ fromName, toName })}
                >
                  {isSaving ? "执行中…" : "执行改名"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="merge">
            <div className="listStack">
              <Select aria-label="将被合并的源角色" value={mergeSourceName} onValueChange={setMergeSourceName} options={characterOptions} placeholder="选择源角色（将被合并）…" />
              <Select aria-label="将保留的目标角色" value={mergeTargetName} onValueChange={setMergeTargetName} options={characterOptions} placeholder="选择目标角色（将保留）…" />
              <div className="muted">预览影响：{mergePreviewCount} 段（目标角色音色优先）</div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !mergeSourceName || !mergeTargetName || mergeSourceName === mergeTargetName || mergePreviewCount <= 0}
                  onClick={() => onMergeCharacter?.({ sourceName: mergeSourceName, targetName: mergeTargetName })}
                >
                  {isSaving ? "执行中…" : "执行合并"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="batch">
            <div className="listStack">
              <div className="muted">选择情绪 -&gt; 目标情绪</div>
              <Select
                aria-label="源情绪"
                value={fromEmotion}
                onValueChange={setFromEmotion}
                options={[{ value: "", label: "全部情绪" }, ...emotionOptionsInScope]}
                placeholder="选择情绪（源）…"
              />
              <Select
                aria-label="目标情绪"
                value={targetEmotion}
                onValueChange={setTargetEmotion}
                options={[{ value: "", label: "目标情绪不改" }, ...EMOTION_OPTIONS]}
                placeholder="目标情绪…"
              />
              <div className="muted">选择类型 -&gt; 目标类型</div>
              <Select
                aria-label="源类型"
                value={fromType}
                onValueChange={setFromType}
                options={[{ value: "", label: "全部类型" }, ...typeOptionsInScope]}
                placeholder="选择类型（源）…"
              />
              <Select
                aria-label="目标类型"
                value={targetType}
                onValueChange={setTargetType}
                options={[{ value: "", label: "目标类型不改" }, ...TYPE_OPTIONS]}
                placeholder="目标类型…"
              />
              <div className="muted">
                预览影响：{batchPreviewCount} 段
                {targetEmotion || targetType
                  ? `（将改为：emotion=${targetEmotion || "不变"}，type=${targetType || "不变"}）`
                  : "（请继续选择目标情绪或目标类型）"}
              </div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || (!targetEmotion && !targetType) || batchPreviewCount <= 0}
                  onClick={() =>
                    onBatchUpdate?.({
                      segmentIds: batchCandidates.map((seg) => seg.id),
                      emotion: targetEmotion || null,
                      type: targetType || null,
                    })
                  }
                >
                  {isSaving ? "执行中…" : "执行批量修改"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="replace">
            <div className="listStack">
              <input
                className="textInput"
                name="findText"
                aria-label="查找文本"
                autoComplete="off"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="查找文本…"
              />
              <input
                className="textInput"
                name="replaceText"
                aria-label="替换文本"
                autoComplete="off"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="替换为（可空）…"
              />
              <label className="controlRow" style={{ justifyContent: "flex-start", gap: 8 }}>
                <input
                  type="checkbox"
                  name="caseSensitive"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
                区分大小写
              </label>
              <div className="muted">预览命中：{searchPreview.hitCount} 处，影响 {searchPreview.affectedCount} 段</div>
              {searchPreview.rows.length ? (
                <div className="listStack" style={{ maxHeight: 180, overflowY: "auto" }}>
                  {searchPreview.rows.map((row) => (
                    <div key={row.segmentId} className="statRow" style={{ display: "block" }}>
                      <div className="muted">#{row.segmentId} · 命中 {row.hit} 次</div>
                      <div className="muted scriptPreviewText">旧：{row.before}</div>
                      <div className="muted scriptPreviewText">新：{row.after}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !findText || searchPreview.affectedCount <= 0}
                  onClick={() => onSearchReplace?.({ find: findText, replace: replaceText, caseSensitive })}
                >
                  {isSaving ? "执行中…" : "执行替换"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="structure">
            <div className="listStack">
              <div className="muted">片段拆分与合并在片段卡片上直接操作：</div>
              <div className="muted">1) 编辑状态点击“拆分”，按光标位置一键拆分</div>
              <div className="muted">2) 非编辑状态点击“合并”可与下一段合并</div>
              <div className="statusBadge default">这些操作也会进入项目历史与快照，可回滚</div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
