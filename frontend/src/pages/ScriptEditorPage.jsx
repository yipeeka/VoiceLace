import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Save, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CharacterBadge, { getCharColor } from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import SegmentEditorFields from "../components/script/SegmentEditorFields";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../constants/scriptOptions";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { formatError } from "../utils/errors";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import { hasEditingDraftChanges } from "../utils/scriptEditorDirty";
import { parseCsvList, parseOverridesJson } from "../utils/segmentDraft";
import { computeScriptDiff, normalizeDraftScript } from "../utils/scriptDiff";

function SortableSegmentCard({
  segment,
  isEditing,
  draft,
  canEdit,
  isSaving,
  onBeginEdit,
  onUpdateDraft,
  onApplyDraft,
  onCancelEdit,
  onDelete,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: segment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const charColor = getCharColor(segment.speaker);

  return (
    <div ref={setNodeRef} style={style} className={`segmentCard ${isEditing ? "editing" : ""}`}>
      {/* Drag handle */}
      {canEdit && !isEditing && (
        <div className="dragHandle" {...attributes} {...listeners}>
          <GripVertical size={15} />
        </div>
      )}

      {/* Color bar */}
      <div className="segmentColorBar" style={{ background: charColor }} />

      {/* Body */}
      <div className="segmentBody">
        {isEditing ? (
          <>
            <SegmentEditorFields
              draft={draft}
              includeAdvanced
              onFieldChange={(field, value) => onUpdateDraft(segment.id, field, value)}
              textMinHeight={56}
            />
            <div className="controlRow">
              <Button
                variant="primary"
                size="sm"
                disabled={isSaving || !draft?.text?.trim()}
                onClick={() => onApplyDraft(segment.id)}
              >
                {isSaving ? "处理中..." : "应用到草稿"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onCancelEdit(segment.id)}>
                取消
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="segmentHeader">
              <span className="segmentIndex">#{(segment.index ?? 0) + 1}</span>
              <CharacterBadge name={segment.speaker || "旁白"} />
              <span className="segmentType">{segment.type}</span>
              {segment.emotion && segment.emotion !== "neutral" && (
                <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>
                  {segment.emotion}
                </span>
              )}
            </div>
            <p className="segmentText">{segment.text}</p>
          </>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="segmentActions">
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onBeginEdit(segment)}
            title="编辑"
          >
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-danger btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onDelete(segment.id)}
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function createSegmentDraft(index) {
  return {
    id: crypto.randomUUID(),
    index,
    type: "dialogue",
    speaker: "",
    text: "",
    emotion: "neutral",
    non_verbal: [],
    tts_overrides: {},
    nonVerbalText: "",
    ttsOverridesText: "{}",
  };
}

function normalizeSegmentFromEditorDraft(draft) {
  const parsed = parseOverridesJson(draft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return {
    ok: true,
    value: {
      ...draft,
      nonVerbalText: undefined,
      ttsOverridesText: undefined,
      speaker: (draft?.speaker || "").trim() || "narrator",
      text: (draft?.text || "").trim(),
      type: draft?.type || "dialogue",
      emotion: draft?.emotion || "neutral",
      non_verbal: parseCsvList(draft?.nonVerbalText),
      tts_overrides: parsed.value,
    },
  };
}

export default function ScriptEditorPage() {
  const { currentProject, currentProjectFileHandle, bindCurrentProjectFile, refreshCurrentProject } = useProjectStore();
  const { script, replaceScript, saveScript, isSaving, error } = useScriptStore();
  const fileInputRef = useRef(null);
  const lastProjectIdRef = useRef(null);

  const [savedScript, setSavedScript] = useState(() => normalizeDraftScript(script));
  const [draftScript, setDraftScript] = useState(() => normalizeDraftScript(script));
  const [editingId, setEditingId] = useState(null);
  const [segmentDraft, setSegmentDraft] = useState(null);
  const [newSegment, setNewSegment] = useState(() => createSegmentDraft(0));
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);

  const canEdit = Boolean(currentProject?.id);
  const segments = draftScript?.segments ?? [];
  const scriptDiff = useMemo(
    () => computeScriptDiff(savedScript, draftScript),
    [savedScript, draftScript]
  );
  const editingDraftDirty = useMemo(() => {
    if (!editingId || !segmentDraft) {
      return false;
    }
    const base = (draftScript?.segments || []).find((segment) => segment.id === editingId);
    return hasEditingDraftChanges(base, segmentDraft);
  }, [draftScript?.segments, editingId, segmentDraft]);
  const hasUnsavedChanges = scriptDiff.hasChanges || editingDraftDirty;

  useEffect(() => {
    const projectId = currentProject?.id || null;
    const normalized = normalizeDraftScript(script);
    if (lastProjectIdRef.current !== projectId) {
      setSavedScript(normalized);
      setDraftScript(normalized);
      setEditingId(null);
      setSegmentDraft(null);
      setNewSegment(createSegmentDraft(normalized.segments.length));
      lastProjectIdRef.current = projectId;
      return;
    }
    if (!computeScriptDiff(savedScript, draftScript).hasChanges) {
      setSavedScript(normalized);
      setDraftScript(normalized);
      setNewSegment((current) => ({ ...current, index: normalized.segments.length }));
    }
  }, [currentProject?.id, script]);

  // Character stats
  const characters = useMemo(() => {
    const counts = {};
    for (const seg of segments) {
      const name = seg.speaker || "旁白";
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [segments]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraftScript((current) => {
      const list = current.segments ?? [];
      const oldIdx = list.findIndex((item) => item.id === active.id);
      const newIdx = list.findIndex((item) => item.id === over.id);
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) {
        return current;
      }
      const reordered = arrayMove(list, oldIdx, newIdx).map((segment, index) => ({ ...segment, index }));
      return { ...current, segments: reordered };
    });
  }

  function beginEdit(segment) {
    setEditingId(segment.id);
    setSegmentDraft({
      ...segment,
      nonVerbalText: Array.isArray(segment.non_verbal) ? segment.non_verbal.join(", ") : "",
      ttsOverridesText: JSON.stringify(segment.tts_overrides || {}, null, 2),
    });
  }

  function cancelEdit(id) {
    setEditingId((current) => (current === id ? null : current));
    setSegmentDraft((current) => (current?.id === id ? null : current));
  }

  function updateDraft(id, field, value) {
    setSegmentDraft((current) => {
      if (!current || current.id !== id) {
        return current;
      }
      return { ...current, [field]: value };
    });
  }

  function applyDraft(id) {
    const draft = segmentDraft;
    if (!draft || draft.id !== id) return;
    const normalized = normalizeSegmentFromEditorDraft(draft);
    if (!normalized.ok) {
      useUiStore.getState().pushToast({
        title: `tts_overrides JSON 格式错误：${normalized.error}`,
        tone: "error",
      });
      return;
    }
    const updated = normalized.value;
    setDraftScript((current) => ({
      ...current,
      segments: (current.segments || []).map((segment, index) =>
        segment.id === id ? { ...updated, index } : { ...segment, index }
      ),
    }));
    cancelEdit(id);
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  function handleAddSegment() {
    if (!newSegment.text.trim()) return;
    const parsed = parseOverridesJson(newSegment.ttsOverridesText || "{}");
    if (!parsed.ok) {
      useUiStore.getState().pushToast({
        title: `新增片段 tts_overrides JSON 格式错误：${parsed.error}`,
        tone: "error",
      });
      return;
    }
    const toAdd = {
      id: crypto.randomUUID(),
      index: segments.length,
      type: newSegment.type || "dialogue",
      speaker: (newSegment.speaker || "").trim() || "narrator",
      text: (newSegment.text || "").trim(),
      emotion: newSegment.emotion || "neutral",
      non_verbal: parseCsvList(newSegment.nonVerbalText),
      tts_overrides: parsed.value,
    };
    setDraftScript((current) => ({
      ...current,
      segments: [...(current.segments || []), toAdd].map((segment, index) => ({ ...segment, index })),
    }));
    setNewSegment(createSegmentDraft(segments.length + 1));
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  function handleDelete(id) {
    setDraftScript((current) => ({
      ...current,
      segments: (current.segments || [])
        .filter((segment) => segment.id !== id)
        .map((segment, index) => ({ ...segment, index })),
    }));
    setEditingId((current) => (current === id ? null : current));
    setSegmentDraft((current) => (current?.id === id ? null : current));
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  async function handleSaveScript() {
    if (!currentProject?.id) return;
    let workingDraftScript = draftScript;
    if (editingId && segmentDraft?.id === editingId) {
      const normalized = normalizeSegmentFromEditorDraft(segmentDraft);
      if (!normalized.ok) {
        useUiStore.getState().pushToast({
          title: `当前编辑片段 tts_overrides JSON 格式错误：${normalized.error}`,
          tone: "error",
        });
        return;
      }
      workingDraftScript = {
        ...draftScript,
        segments: (draftScript.segments || []).map((segment, index) =>
          segment.id === editingId ? { ...normalized.value, index } : { ...segment, index }
        ),
      };
    }

    const mergedSegments = (workingDraftScript.segments || []).map((segment, index) => ({
      ...segment,
      index,
      speaker: (segment.speaker || "").trim() || "narrator",
      text: (segment.text || "").trim(),
      type: segment.type || "dialogue",
      emotion: segment.emotion || "neutral",
      non_verbal: Array.isArray(segment.non_verbal) ? segment.non_verbal : [],
      tts_overrides: segment.tts_overrides && typeof segment.tts_overrides === "object" && !Array.isArray(segment.tts_overrides)
        ? segment.tts_overrides
        : {},
    }));
    const payload = {
      ...savedScript,
      ...workingDraftScript,
      segments: mergedSegments,
    };
    const updated = await saveScript({ projectId: currentProject.id, script: payload });
    await refreshCurrentProject(currentProject.id);
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    setDraftScript(normalized);
    setEditingId(null);
    setSegmentDraft(null);
  }

  function handleExportJson() {
    if (!draftScript) return;
    const blob = new Blob([JSON.stringify(draftScript, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(currentProject?.name || "script").replace(/[\\/:|*?"<>]/g, "_")}.script.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    useUiStore.getState().pushToast({ title: "已导出剧本 JSON", tone: "success" });
  }

  const handleSaveProjectFile = useCallback(async () => {
    if (!currentProject) {
      return;
    }
    const payload = buildProjectFilePayload({
      project: currentProject,
      script: draftScript || script,
      sourceText: draftScript?.source_text || script?.source_text || "",
    });
    try {
      const result = await saveProjectFile({
        payload,
        preferredName: currentProject.name,
        existingHandle: currentProjectFileHandle || null,
      });
      if (result?.handle) {
        bindCurrentProjectFile({ handle: result.handle, fileName: result.fileName || "" });
      }
      useUiStore.getState().pushToast({
        title: result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({ title: formatError("保存项目失败", error), tone: "error" });
    }
  }, [currentProject, draftScript, script, currentProjectFileHandle, bindCurrentProjectFile]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  async function handleImportJson(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !currentProject?.id) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      const updated = await replaceScript({ projectId: currentProject.id, script: imported });
      await refreshCurrentProject(currentProject.id);
      const normalized = normalizeDraftScript(updated);
      setSavedScript(normalized);
      setDraftScript(normalized);
      setEditingId(null);
      setSegmentDraft(null);
      setNewSegment(createSegmentDraft(normalized.segments.length));
    } catch (err) {
      useUiStore.getState().pushToast({ title: formatError("导入失败", err), tone: "error" });
    }
  }

  return (
    <div className="pageGrid sidebarLayout">
      {/* Left: character panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GlassCard>
          <h2 className="cardTitle"><Users size={16} /> 角色面板</h2>
          {characters.length ? (
            <div className="listStack">
              {characters.map(({ name, count }) => (
                <div key={name} className="statRow" style={{ gap: 8 }}>
                  <CharacterBadge name={name} />
                  <span className="muted" style={{ marginLeft: "auto" }}>
                    {count} 段
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无角色" description="解析后角色将在此显示" />
          )}
          <div
            className="statRow"
            style={{ marginTop: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}
          >
            <span style={{ color: "var(--text-muted)" }}>总计</span>
            <strong>{segments.length} 段</strong>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="cardTitle">操作</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {hasUnsavedChanges ? (
              <div className="statusBadge warning">有未保存改动</div>
            ) : (
              <div className="statusBadge success">已保存</div>
            )}
            <Button variant="primary" onClick={handleSaveScript} disabled={!canEdit || isSaving || !hasUnsavedChanges}>
              <Save size={14} />
              {isSaving ? "保存中..." : hasUnsavedChanges ? "保存剧本" : "已保存"}
            </Button>
            <Button variant="secondary" onClick={handleExportJson} disabled={!script?.segments?.length}>
              导出 JSON
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
              导入 JSON
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportJson} />
          </div>
          {error && <div className="errorText">⚠ {error}</div>}
        </GlassCard>

        {/* Add segment */}
        <GlassCard>
          <h2 className="cardTitle">新增片段</h2>
          <div className="formGroup">
            <label className="formLabel">角色</label>
            <input
              className="textInput"
              value={newSegment.speaker}
              onChange={(e) => setNewSegment((s) => ({ ...s, speaker: e.target.value }))}
              placeholder="角色名（空 = narrator）"
            />
          </div>
          <div className="formGroup">
            <label className="formLabel">类型</label>
            <Select
              value={newSegment.type}
              onValueChange={(v) => setNewSegment((s) => ({ ...s, type: v }))}
              options={TYPE_OPTIONS}
            />
          </div>
          <textarea
            className="textArea compactArea"
            value={newSegment.text}
            onChange={(e) => setNewSegment((s) => ({ ...s, text: e.target.value }))}
            placeholder="台词或旁白内容..."
          />
          <Button
            variant="primary"
            disabled={!canEdit || isSaving || !newSegment.text.trim()}
            onClick={handleAddSegment}
          >
            + 添加片段
          </Button>
        </GlassCard>
      </div>

      {/* Right: segment list */}
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">片段列表</h2>
            <p className="cardSubtitle">
              拖动左侧手柄可调整顺序，点击内容编辑片段。{hasUnsavedChanges ? "（当前有未保存改动）" : "（当前已保存）"}
            </p>
          </div>
        </div>

        {segments.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={segments.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="listStack">
                {segments.map((segment) => (
                  <SortableSegmentCard
                    key={segment.id}
                    segment={segment}
                    isEditing={editingId === segment.id}
                    draft={segmentDraft?.id === segment.id ? segmentDraft : null}
                    canEdit={canEdit}
                    isSaving={isSaving}
                    onBeginEdit={beginEdit}
                    onUpdateDraft={updateDraft}
                    onApplyDraft={applyDraft}
                    onCancelEdit={cancelEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <EmptyState
            title="还没有剧本片段"
            description="先在「文本输入」页完成 LLM 解析，或手动添加片段"
          />
        )}
      </GlassCard>
    </div>
  );
}
