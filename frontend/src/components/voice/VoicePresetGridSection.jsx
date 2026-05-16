import { Plus, Search } from "lucide-react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";

import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import SortablePresetCard from "./SortablePresetCard";
import { QUALITY_FILTER_OPTIONS } from "../../utils/voiceConfigData";

export default function VoicePresetGridSection({
  activeBackend,
  allTags,
  displayPresetIds,
  displayPresets,
  favoriteOnly,
  isFilterActive,
  onCyclePresetVoiceMode,
  onDragEnd,
  onFavoriteOnlyChange,
  onNewPreset,
  onPreviewPreset,
  onQualityFilterChange,
  onResetFilters,
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
      <div className="voicePresetLibraryHeader">
        <div className="voicePresetLibraryHeaderText">
          <h2 className="cardTitle">声音预设</h2>
          <p className="cardSubtitle">选择卡片查看设定，拖拽卡片调整顺序。</p>
        </div>
        <div className="voicePresetLibraryActions">
          <span className="voicePresetResultCount" role="status">
            显示 {displayPresets.length} / {presets.length}
          </span>
          <Button variant="primary" size="sm" icon={Plus} onClick={onNewPreset}>
            新建预设
          </Button>
        </div>
      </div>

      <div className="voicePresetFilterBar">
        <div className="formGroup">
          <label className="formLabel" htmlFor="voice-preset-search">搜索</label>
          <div style={{ position: "relative" }}>
            <Search aria-hidden="true" focusable="false" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
            <input
              id="voice-preset-search"
              name="voicePresetSearch"
              className="textInput"
              style={{ paddingLeft: 32 }}
              value={searchKeyword}
              onChange={(e) => onSearchKeywordChange(e.target.value)}
              autoComplete="off"
              placeholder="按名称、标签、描述搜索…"
            />
          </div>
        </div>
        <div className="formGroup">
          <label className="formLabel">标签筛选</label>
          <Select
            aria-label="标签筛选"
            value={tagFilter}
            onValueChange={onTagFilterChange}
            options={[{ value: "all", label: "全部标签" }, ...allTags.map((tag) => ({ value: tag, label: tag }))]}
          />
        </div>
        <div className="formGroup">
          <label className="formLabel">质量筛选</label>
          <Select
            aria-label="质量筛选"
            value={qualityFilter}
            onValueChange={onQualityFilterChange}
            options={QUALITY_FILTER_OPTIONS}
          />
        </div>
        <label className="checkRow voicePresetFavoriteFilter">
          <input
            type="checkbox"
            name="voicePresetFavoriteOnly"
            checked={favoriteOnly}
            onChange={(e) => onFavoriteOnlyChange(e.target.checked)}
          />
          <span>只看收藏</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={!isFilterActive}
          onClick={onResetFilters}
        >
          清除筛选
        </Button>
      </div>
      {presets.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={displayPresetIds} strategy={rectSortingStrategy}>
            <div className="presetGrid">
              {!displayPresets.length ? (
                <div className="presetCard presetNoMatchCard">
                  <strong>没有匹配的预设</strong>
                  <span className="muted">调整搜索词或清除筛选后再试。</span>
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
              <button
                type="button"
                className="presetCard presetCreateCard"
                onClick={onNewPreset}
              >
                <Plus aria-hidden="true" focusable="false" size={24} style={{ color: "var(--text-muted)" }} />
                <span className="muted">新建预设</span>
              </button>
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
