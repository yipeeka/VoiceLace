import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CharacterBadge, { getCharColor } from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import SegmentEditorFields from "../components/script/SegmentEditorFields";
import ScriptSidebarColumn from "../components/script/ScriptSidebarColumn";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { formatError } from "../utils/errors";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import { buildSegmentEditorDraft, createSegmentDraft, normalizeSegmentFromEditorDraft } from "../utils/segmentEditorState";
import { buildCharacterStats, buildSpeakerOptions, filterSegmentsBySpeaker, getInsertAnchorLabel } from "../utils/scriptSidebar";
import { hasEditingDraftChanges } from "../utils/scriptEditorDirty";
import { computeScriptDiff, normalizeDraftScript } from "../utils/scriptDiff";

function SortableSegmentCard({
  segment,
  isEditing,
  isInsertAnchor,
  draft,
  speakerOptions,
  canEdit,
  canReorder,
  isSaving,
  onBeginEdit,
  onUpdateDraft,
  onApplyDraft,
  onCancelEdit,
  onSetInsertAnchor,
  onDelete,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: segment.id,
    disabled: !canReorder || isEditing || isSaving,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const charColor = getCharColor(segment.speaker);

  return (
    <div ref={setNodeRef} style={style} className={`segmentCard ${isEditing ? "editing" : ""} ${isInsertAnchor ? "insertAnchor" : ""}`}>
      {/* Drag handle */}
      {canEdit && !isEditing && (
        <div
          className={`dragHandle ${canReorder ? "" : "disabled"}`}
          title={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
          aria-label={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
          {...(canReorder ? { ...attributes, ...listeners } : {})}
        >
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
              speakerOptions={speakerOptions}
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
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onSetInsertAnchor(segment.id)}
            title="新增片段插入到此段后"
          >
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  );
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
  const [insertAfterSegmentId, setInsertAfterSegmentId] = useState(null);
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState("all");
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
      setInsertAfterSegmentId(null);
      setActiveSpeakerFilter("all");
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
  const characters = useMemo(() => buildCharacterStats(segments), [segments]);
  const newSegmentSpeakerOptions = useMemo(
    () => buildSpeakerOptions(characters, { includeCreateOption: true }),
    [characters]
  );
  const segmentSpeakerOptions = useMemo(() => buildSpeakerOptions(characters), [characters]);
  const visibleSegments = useMemo(
    () => filterSegmentsBySpeaker(segments, activeSpeakerFilter),
    [segments, activeSpeakerFilter]
  );
  const isFilterActive = activeSpeakerFilter !== "all";
  const insertAfterLabel = useMemo(
    () => getInsertAnchorLabel(segments, insertAfterSegmentId),
    [segments, insertAfterSegmentId]
  );

  useEffect(() => {
    if (activeSpeakerFilter === "all") {
      return;
    }
    const exists = characters.some((character) => character.name === activeSpeakerFilter);
    if (!exists) {
      setActiveSpeakerFilter("all");
    }
  }, [activeSpeakerFilter, characters]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (isFilterActive) return;
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
    setSegmentDraft(buildSegmentEditorDraft(segment));
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
    const normalized = normalizeSegmentFromEditorDraft(newSegment);
    if (!normalized.ok) {
      useUiStore.getState().pushToast({
        title: `新增片段 tts_overrides JSON 格式错误：${normalized.error}`,
        tone: "error",
      });
      return;
    }
    const toAdd = {
      ...normalized.value,
      id: normalized.value.id || crypto.randomUUID(),
      index: 0,
    };
    setDraftScript((current) => ({
      ...current,
      segments: (() => {
        const list = [...(current.segments || [])];
        const insertIndex = insertAfterSegmentId
          ? Math.max(0, list.findIndex((segment) => segment.id === insertAfterSegmentId) + 1)
          : list.length;
        const safeIndex = insertAfterSegmentId && insertIndex === 0 ? list.length : insertIndex;
        list.splice(safeIndex, 0, toAdd);
        return list.map((segment, index) => ({ ...segment, index }));
      })(),
    }));
    setNewSegment(createSegmentDraft(segments.length + 1));
    setInsertAfterSegmentId(null);
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
    setInsertAfterSegmentId((current) => (current === id ? null : current));
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

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    const forceSaveAs = Boolean(options?.forceSaveAs);
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
        forceSaveAs,
      });
      if (result?.handle) {
        bindCurrentProjectFile({ handle: result.handle, fileName: result.fileName || "" });
      }
      useUiStore.getState().pushToast({
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
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
      <ScriptSidebarColumn
        characters={characters}
        totalSegments={segments.length}
        activeSpeakerFilter={activeSpeakerFilter}
        onSelectSpeaker={setActiveSpeakerFilter}
        hasUnsavedChanges={hasUnsavedChanges}
        error={error}
        newSegment={newSegment}
        newSegmentSpeakerOptions={newSegmentSpeakerOptions}
        canEdit={canEdit}
        isSaving={isSaving}
        insertAfterLabel={insertAfterLabel}
        onClearInsertAnchor={() => setInsertAfterSegmentId(null)}
        onNewSegmentFieldChange={(field, value) => setNewSegment((current) => ({ ...current, [field]: value }))}
        onAddSegment={handleAddSegment}
        actionContent={
          <>
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
          </>
        }
      />

      {/* Right: segment list */}
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">片段列表</h2>
            <p className="cardSubtitle">
              {isFilterActive
                ? `当前按角色筛选显示，拖拽排序已暂时关闭。${hasUnsavedChanges ? "（当前有未保存改动）" : "（当前已保存）"}`
                : `拖动左侧手柄可调整顺序，点击内容编辑片段。${hasUnsavedChanges ? "（当前有未保存改动）" : "（当前已保存）"}`}
            </p>
          </div>
        </div>

        {visibleSegments.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleSegments.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="listStack">
                {visibleSegments.map((segment) => (
                  <SortableSegmentCard
                    key={segment.id}
                    segment={segment}
                    isEditing={editingId === segment.id}
                    isInsertAnchor={insertAfterSegmentId === segment.id}
                    draft={segmentDraft?.id === segment.id ? segmentDraft : null}
                    speakerOptions={segmentSpeakerOptions}
                    canEdit={canEdit}
                    canReorder={!isFilterActive}
                    isSaving={isSaving}
                    onBeginEdit={beginEdit}
                    onUpdateDraft={updateDraft}
                    onApplyDraft={applyDraft}
                    onCancelEdit={cancelEdit}
                    onSetInsertAnchor={setInsertAfterSegmentId}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : segments.length ? (
          <EmptyState
            title="该角色暂无段落"
            description="点击左侧“总计”可恢复查看全部片段"
          />
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
