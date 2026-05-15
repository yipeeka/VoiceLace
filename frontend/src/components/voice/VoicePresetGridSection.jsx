import { Plus, Search } from "lucide-react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";

import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Select from "../ui/Select";
import SortablePresetCard from "./SortablePresetCard";
import { QUALITY_FILTER_OPTIONS } from "../../utils/voiceConfigData";

export default function VoicePresetGridSection({
  activeBackend,
  allTags,
  displayPresetIds,
  displayPresets,
  favoriteOnly,
  onCyclePresetVoiceMode,
  onDragEnd,
  onFavoriteOnlyChange,
  onNewPreset,
  onPreviewPreset,
  onQualityFilterChange,
  onSearchKeywordChange,
  onSelectPreset,
  onSetSelectedPresetId,
  onSetDeleteTarget,
  onSetPreviewSlotPreset,
  onTagFilterChange,
  presets,
  qualityFilter,
  searchKeyword,
  selectedPresetId,
  sensors,
  tagFilter,
}) {
  return (
    <GlassCard>
      <h2 className="cardTitle">声音预设</h2>
      <p className="cardSubtitle">可拖拽调整预设顺序，新的顺序会自动保存。</p>
      <div className="editorGrid">
        <div className="formGroup">
          <label className="formLabel">搜索</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
            <input
              className="textInput"
              style={{ paddingLeft: 32 }}
              value={searchKeyword}
              onChange={(e) => onSearchKeywordChange(e.target.value)}
              placeholder="按名称、标签、描述搜索"
            />
          </div>
        </div>
        <div className="formGroup">
          <label className="formLabel">标签筛选</label>
          <Select
            value={tagFilter}
            onValueChange={onTagFilterChange}
            options={[{ value: "all", label: "全部标签" }, ...allTags.map((tag) => ({ value: tag, label: tag }))]}
          />
        </div>
      </div>
      <div className="editorGrid">
        <div className="formGroup">
          <label className="formLabel">质量筛选</label>
          <Select
            value={qualityFilter}
            onValueChange={onQualityFilterChange}
            options={QUALITY_FILTER_OPTIONS}
          />
        </div>
        <label className="checkRow" style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 24 }}>
          <input
            type="checkbox"
            checked={favoriteOnly}
            onChange={(e) => onFavoriteOnlyChange(e.target.checked)}
          />
          <span>只看收藏</span>
        </label>
      </div>
      {presets.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={displayPresetIds} strategy={rectSortingStrategy}>
            <div className="presetGrid">
              {!displayPresets.length ? (
                <div className="presetCard" style={{ minHeight: 140, justifyContent: "center", alignItems: "center" }}>
                  <span className="muted">当前筛选无匹配预设</span>
                </div>
              ) : null}
              {displayPresets.map((preset) => (
                <SortablePresetCard
                  key={preset.id}
                  preset={preset}
                  displayBackend={activeBackend}
                  isSelected={selectedPresetId === preset.id}
                  onToggleSelect={() => onSelectPreset(preset)}
                  onDelete={() => onSetDeleteTarget(preset.id)}
                  onPreview={() => onPreviewPreset(preset)}
                  onUseSlotA={() => {
                    onSetPreviewSlotPreset("a", preset.id);
                    onSetSelectedPresetId(preset.id);
                  }}
                  onUseSlotB={() => {
                    onSetPreviewSlotPreset("b", preset.id);
                    onSetSelectedPresetId(preset.id);
                  }}
                  onCycleMode={() => onCyclePresetVoiceMode(preset)}
                />
              ))}
              <div
                className="presetCard"
                style={{ borderStyle: "dashed", cursor: "pointer", alignItems: "center", justifyContent: "center", minHeight: 140 }}
                onClick={onNewPreset}
              >
                <Plus size={24} style={{ color: "var(--text-muted)" }} />
                <span className="muted">新建预设</span>
              </div>
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <EmptyState
          title="还没有声音预设"
          description="在上方表单中填写并点击「创建预设」"
        />
      )}
    </GlassCard>
  );
}
