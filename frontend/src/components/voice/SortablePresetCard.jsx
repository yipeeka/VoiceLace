import { GripVertical, Pause, Play, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Button from "../ui/Button";
import {
  buildReferenceAudioUrl,
  AGE_OPTIONS,
  GENDER_OPTIONS,
  PITCH_OPTIONS,
  STYLE_OPTIONS,
  qualityStatusLabel,
  resolveOmniProfile,
  resolvePresetQualityStatus,
  resolveVoxProfile,
} from "../../utils/voiceConfigData";

function optionLabel(options, value) {
  if (!value) return "未指定";
  return options.find((option) => option.value === value)?.label || value;
}

function displayText(value, fallback = "未填写") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function fileName(path) {
  const text = displayText(path, "");
  return text ? text.split(/[\\/]/).pop() : "未设置";
}

function SettingRow({ label, value, mono = false }) {
  return (
    <div className="presetSettingRow">
      <span className="presetSettingLabel">{label}</span>
      <span className={mono ? "presetSettingValue mono" : "presetSettingValue"} title={String(value || "")}>
        {value}
      </span>
    </div>
  );
}

function PresetSampleButton({ preset }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioUrl = buildReferenceAudioUrl(preset.sample_audio_path);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const stop = () => setIsPlaying(false);
    audio.addEventListener("ended", stop);
    audio.addEventListener("pause", stop);
    return () => {
      audio.removeEventListener("ended", stop);
      audio.removeEventListener("pause", stop);
    };
  }, [audioUrl]);

  if (!audioUrl) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={isPlaying ? Pause : Play}
        aria-label={`${isPlaying ? "暂停" : "播放"} ${preset.name} 的预存样音`}
        onClick={async (e) => {
          e.stopPropagation();
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) {
            try {
              await audio.play();
              setIsPlaying(true);
            } catch {
              setIsPlaying(false);
            }
            return;
          }
          audio.pause();
          setIsPlaying(false);
        }}
      >
        样音
      </Button>
      <audio ref={audioRef} src={audioUrl} preload="metadata" style={{ display: "none" }} />
    </>
  );
}

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
  const omniProfile = resolveOmniProfile(preset);
  const voxProfile = resolveVoxProfile(preset);
  const currentProfile = (displayBackend || "omnivoice") === "voxcpm2" ? voxProfile : omniProfile;
  const currentMode = currentProfile?.voice_mode || displayMode;
  const summaryChips = [
    optionLabel(GENDER_OPTIONS, omniProfile.gender),
    optionLabel(AGE_OPTIONS, omniProfile.age),
    optionLabel(PITCH_OPTIONS, omniProfile.pitch),
    optionLabel(STYLE_OPTIONS, omniProfile.style),
  ].filter((item) => item !== "未指定");
  const compactSummary = summaryChips.length ? summaryChips.slice(0, 3).join(" / ") : "点击查看设定值";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`presetCard ${isSelected ? "selected" : ""}`}
    >
      <div className="presetCardTopRow">
        <button
          type="button"
          className="presetCardSelect"
          onClick={onToggleSelect}
          aria-expanded={isSelected}
          aria-label={`${preset.name}，${isSelected ? "隐藏" : "查看"}设定值`}
        >
          <div className="presetAvatar">
            {preset.gender === "female" ? "♀" : preset.gender === "male" ? "♂" : "🎙"}
          </div>
          <div className="presetCardMain">
            <div className="presetName" title={preset.name}>{preset.name}</div>
            <div className="presetSummary" title={compactSummary}>{compactSummary}</div>
          </div>
        </button>
        <button
          type="button"
          className="presetDragButton"
          title="拖拽调整顺序"
          aria-label="拖拽调整顺序"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" focusable="false" size={14} />
        </button>
      </div>
      <div className="presetMetaRow">
        <span className={`presetSelectedHint ${isSelected ? "active" : ""}`}>
          {isSelected ? "已展开设定" : "点击卡片查看"}
        </span>
        <span className={`statusBadge ${qualityStatus === "pass" ? "success" : qualityStatus === "warning" ? "warning" : qualityStatus === "fail" ? "error" : "default"}`}>
          {qualityStatusLabel(qualityStatus)}
        </span>
      </div>
      {preset.favorite ? <span className="presetFavorite"><Star size={12} fill="currentColor" /> 收藏</span> : null}
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
      {isSelected ? (
        <div className="presetSettingsPanel">
          <div className="presetSettingsHeader">
            <span>当前设定速览</span>
            <span>{(displayBackend || "omnivoice") === "voxcpm2" ? "VoxCPM2" : "OmniVoice"} · {String(currentMode).toUpperCase()}</span>
          </div>
          <div className="presetSettingsGrid">
            <SettingRow label="性别" value={optionLabel(GENDER_OPTIONS, omniProfile.gender)} />
            <SettingRow label="年龄" value={optionLabel(AGE_OPTIONS, omniProfile.age)} />
            <SettingRow label="音调" value={optionLabel(PITCH_OPTIONS, omniProfile.pitch)} />
            <SettingRow label="风格" value={optionLabel(STYLE_OPTIONS, omniProfile.style)} />
            <SettingRow label="语速" value={`${Number(omniProfile.speed || 1).toFixed(2)}x`} mono />
            <SettingRow label="口音" value={displayText(omniProfile.accent)} />
            <SettingRow label="方言" value={displayText(omniProfile.dialect)} />
            <SettingRow label="Clone 步数" value={String(omniProfile.clone_num_step || 32)} mono />
            <SettingRow label="Guidance" value={Number(omniProfile.clone_guidance_scale || 2).toFixed(1)} mono />
            <SettingRow label="Vox cfg" value={Number(voxProfile.cfg_value || 2).toFixed(1)} mono />
            <SettingRow label="Vox 步数" value={String(voxProfile.inference_timesteps || 10)} mono />
            <SettingRow
              label="去噪"
              value={`Omni ${omniProfile.clone_denoise ? "开" : "关"} / Vox ${voxProfile.denoise ? "开" : "关"}`}
            />
          </div>
          <div className="presetPromptPreview">
            <span>描述</span>
            <p>{displayText(preset.description)}</p>
          </div>
          <div className="presetPromptPreview">
            <span>Omni 指令</span>
            <p>{displayText(omniProfile.custom_instruct)}</p>
          </div>
          <div className="presetPromptPreview">
            <span>Vox 指令</span>
            <p>{displayText(voxProfile.design_instruction || voxProfile.control_instruction)}</p>
          </div>
          <div className="presetReferenceRow">
            <span>预存样音</span>
            <strong title={preset.sample_audio_path || ""}>
              {fileName(preset.sample_audio_path)}
            </strong>
          </div>
          <div className="presetReferenceRow">
            <span>参考音频</span>
            <strong title={omniProfile.ref_audio_path || voxProfile.ref_audio_path || ""}>
              {fileName(omniProfile.ref_audio_path || voxProfile.ref_audio_path)}
            </strong>
          </div>
        </div>
      ) : null}
      <div className="controlRow" style={{ marginTop: 4 }}>
        <PresetSampleButton preset={preset} />
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
          aria-label={`删除 ${preset.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </div>
  );
}
