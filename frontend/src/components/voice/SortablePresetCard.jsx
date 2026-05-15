import { GripVertical, Star, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Button from "../ui/Button";
import { qualityStatusLabel, resolvePresetQualityStatus } from "../../utils/voiceConfigData";

export default function SortablePresetCard({
  preset,
  displayBackend,
  isSelected,
  onToggleSelect,
  onPreview,
  onDelete,
  onUseSlotA,
  onUseSlotB,
  onCycleMode,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
  };
  const displayMode = preset?.voice_mode || "auto";
  const qualityStatus = resolvePresetQualityStatus(preset, displayBackend || "omnivoice");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`presetCard ${isSelected ? "selected" : ""}`}
      onClick={onToggleSelect}
    >
      <button
        type="button"
        className="primaryButton ghostButton"
        title="拖拽调整顺序"
        aria-label="拖拽调整顺序"
        style={{
          alignSelf: "flex-end",
          cursor: isDragging ? "grabbing" : "grab",
          padding: "4px 6px",
          border: "1px solid rgba(255,255,255,0.22)",
          background: "rgba(255,255,255,0.08)",
        }}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <div className="presetAvatar">
        {preset.gender === "female" ? "♀" : preset.gender === "male" ? "♂" : "🎙"}
      </div>
      <div className="presetName" title={preset.name}>{preset.name}</div>
      <div className="presetMetaRow">
        {preset.favorite ? <span className="presetFavorite"><Star size={12} fill="currentColor" /> 收藏</span> : null}
        <span className={`statusBadge ${qualityStatus === "pass" ? "success" : qualityStatus === "warning" ? "warning" : qualityStatus === "fail" ? "error" : "default"}`}>
          {qualityStatusLabel(qualityStatus)}
        </span>
      </div>
      {Array.isArray(preset.tags) && preset.tags.length ? (
        <div className="presetTags">
          {preset.tags.slice(0, 3).map((tag) => (
            <span key={`${preset.id}-${tag}`} className="presetTag">{tag}</span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={`presetModeBadge presetModeButton ${displayMode}`}
        onClick={(e) => {
          e.stopPropagation();
          onCycleMode?.();
        }}
        title="点击切换 voice_mode"
      >
        {String(displayMode || "auto").toUpperCase()}
      </button>
      <div className="controlRow" style={{ marginTop: 4 }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          试听
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onUseSlotA?.();
          }}
        >
          放入A
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onUseSlotB?.();
          }}
        >
          放入B
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </div>
  );
}
