import { Users } from "lucide-react";

import CharacterBadge from "../shared/CharacterBadge";
import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import SegmentEditorFields from "./SegmentEditorFields";
import Button from "../ui/Button";

export default function ScriptSidebarColumn({
  characters,
  totalSegments,
  activeSpeakerFilter = "all",
  onSelectSpeaker = null,
  hasUnsavedChanges = false,
  actionContent = null,
  error = "",
  newSegment,
  newSegmentSpeakerOptions,
  canEdit,
  isSaving,
  insertAfterLabel = "",
  onClearInsertAnchor = null,
  onNewSegmentFieldChange,
  onAddSegment,
  addButtonLabel = "+ 添加片段",
}) {
  const isFilterable = typeof onSelectSpeaker === "function";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GlassCard>
        <h2 className="cardTitle"><Users size={16} /> 角色面板</h2>
        {characters.length ? (
          <div className="listStack">
            <button
              type="button"
              className={`statRow ${isFilterable ? "statRowButton" : ""} ${activeSpeakerFilter === "all" ? "active" : ""}`}
              onClick={isFilterable ? () => onSelectSpeaker("all") : undefined}
              disabled={!isFilterable}
            >
              <span>总计</span>
              <strong>{totalSegments} 段</strong>
            </button>
            {characters.map(({ name, count }) => (
              <button
                key={name}
                type="button"
                className={`statRow ${isFilterable ? "statRowButton" : ""} ${activeSpeakerFilter === name ? "active" : ""}`}
                onClick={isFilterable ? () => onSelectSpeaker(name) : undefined}
                disabled={!isFilterable}
                title={name}
              >
                <CharacterBadge name={name} />
                <span className="muted" style={{ marginLeft: "auto" }}>
                  {count} 段
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无角色" description="解析后角色将在此显示" />
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">操作</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hasUnsavedChanges ? (
            <div className="statusBadge warning">有未保存改动</div>
          ) : (
            <div className="statusBadge success">已保存</div>
          )}
          {actionContent}
        </div>
        {error ? <div className="errorText">⚠ {error}</div> : null}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">新增片段</h2>
        <div className="controlRow" style={{ justifyContent: "space-between" }}>
          <span className="muted">{insertAfterLabel || "默认追加到末尾"}</span>
          {insertAfterLabel && onClearInsertAnchor ? (
            <Button variant="ghost" size="sm" onClick={onClearInsertAnchor}>
              改为追加到末尾
            </Button>
          ) : null}
        </div>
        <SegmentEditorFields
          draft={newSegment}
          includeAdvanced={false}
          compact
          speakerOptions={newSegmentSpeakerOptions}
          textMinHeight={72}
          onFieldChange={onNewSegmentFieldChange}
        />
        <Button
          variant="primary"
          disabled={!canEdit || isSaving || !newSegment?.text?.trim()}
          onClick={onAddSegment}
        >
          {addButtonLabel}
        </Button>
      </GlassCard>
    </div>
  );
}
