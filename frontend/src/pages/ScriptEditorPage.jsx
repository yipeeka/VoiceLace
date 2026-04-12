import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import CharacterBadge, { getCharColor } from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { formatError } from "../utils/errors";

const TYPE_OPTIONS = [
  { value: "dialogue",  label: "对话 (dialogue)" },
  { value: "narration", label: "旁白 (narration)" },
  { value: "direction", label: "舞台指示 (direction)" },
];

const EMOTION_OPTIONS = [
  { value: "neutral",    label: "neutral" },
  { value: "happy",      label: "happy" },
  { value: "sad",        label: "sad" },
  { value: "angry",      label: "angry" },
  { value: "gentle",     label: "gentle" },
  { value: "fearful",    label: "fearful" },
  { value: "surprised",  label: "surprised" },
  { value: "disgusted",  label: "disgusted" },
  { value: "apologetic", label: "apologetic" },
];

function SortableSegmentCard({ segment, isEditing, draft, canEdit, isSaving, onBeginEdit, onUpdateDraft, onSaveDraft, onCancelEdit, onDelete }) {
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
            <div className="editorGrid" style={{ marginBottom: 8 }}>
              <div className="formGroup">
                <label className="formLabel">角色</label>
                <input
                  className="textInput"
                  value={draft?.speaker ?? ""}
                  onChange={(e) => onUpdateDraft(segment.id, "speaker", e.target.value)}
                  placeholder="角色名（空 = narrator）"
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">类型</label>
                <Select
                  value={draft?.type ?? "dialogue"}
                  onValueChange={(v) => onUpdateDraft(segment.id, "type", v)}
                  options={TYPE_OPTIONS}
                />
              </div>
            </div>
            <div className="formGroup" style={{ marginBottom: 8 }}>
              <label className="formLabel">情感</label>
              <Select
                value={draft?.emotion ?? "neutral"}
                onValueChange={(v) => onUpdateDraft(segment.id, "emotion", v)}
                options={EMOTION_OPTIONS}
              />
            </div>
            <textarea
              className="textArea compactArea"
              value={draft?.text ?? ""}
              onChange={(e) => onUpdateDraft(segment.id, "text", e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div className="controlRow">
              <Button
                variant="primary"
                size="sm"
                disabled={isSaving || !draft?.text?.trim()}
                onClick={() => onSaveDraft(segment.id)}
              >
                {isSaving ? "保存中..." : "💾 保存"}
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
  return { id: crypto.randomUUID(), index, type: "dialogue", speaker: "", text: "", emotion: "neutral", non_verbal: [], tts_overrides: {} };
}

export default function ScriptEditorPage() {
  const { currentProject, refreshCurrentProject } = useProjectStore();
  const { script, updateSegment, addSegment, deleteSegment, replaceScript, isSaving, error } = useScriptStore();
  const fileInputRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [newSegment, setNewSegment] = useState(() => createSegmentDraft(0));
  const [segmentOrder, setSegmentOrder] = useState(null); // local drag order

  const canEdit = Boolean(currentProject?.id);
  const segments = useMemo(() => {
    const base = script.segments ?? [];
    if (!segmentOrder) return base;
    const map = Object.fromEntries(base.map((s) => [s.id, s]));
    return segmentOrder.map((id) => map[id]).filter(Boolean);
  }, [script.segments, segmentOrder]);

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
    setSegmentOrder((order) => {
      const ids = order ?? segments.map((s) => s.id);
      const oldIdx = ids.indexOf(active.id);
      const newIdx = ids.indexOf(over.id);
      return arrayMove(ids, oldIdx, newIdx);
    });
  }

  function beginEdit(segment) {
    setEditingId(segment.id);
    setDrafts((s) => ({ ...s, [segment.id]: { ...segment } }));
  }

  function cancelEdit(id) {
    setEditingId((c) => (c === id ? null : c));
    setDrafts((s) => { const n = { ...s }; delete n[id]; return n; });
  }

  function updateDraft(id, field, value) {
    setDrafts((s) => ({ ...s, [id]: { ...s[id], [field]: value } }));
  }

  async function saveDraft(id) {
    const draft = drafts[id];
    if (!draft || !currentProject?.id) return;
    await updateSegment({ projectId: currentProject.id, segmentId: id, segment: { ...draft, speaker: draft.speaker.trim() || "narrator", text: draft.text.trim() } });
    await refreshCurrentProject(currentProject.id);
    cancelEdit(id);
  }

  async function handleAddSegment() {
    if (!currentProject?.id || !newSegment.text.trim()) return;
    await addSegment({ projectId: currentProject.id, segment: { ...newSegment, index: segments.length, speaker: newSegment.speaker.trim() || "narrator", text: newSegment.text.trim() } });
    await refreshCurrentProject(currentProject.id);
    setNewSegment(createSegmentDraft(segments.length + 1));
  }

  async function handleDelete(id) {
    if (!currentProject?.id) return;
    await deleteSegment({ projectId: currentProject.id, segmentId: id });
    await refreshCurrentProject(currentProject.id);
  }

  function handleExportJson() {
    if (!script) return;
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: "application/json" });
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

  async function handleImportJson(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !currentProject?.id) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      await replaceScript({ projectId: currentProject.id, script: imported });
      await refreshCurrentProject(currentProject.id);
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
            <p className="cardSubtitle">拖动左侧手柄可调整顺序，点击内容编辑片段。</p>
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
                    draft={drafts[segment.id]}
                    canEdit={canEdit}
                    isSaving={isSaving}
                    onBeginEdit={beginEdit}
                    onUpdateDraft={updateDraft}
                    onSaveDraft={saveDraft}
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
