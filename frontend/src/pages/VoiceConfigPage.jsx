import { GripVertical, Mic, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import AudioPlayer from "../components/shared/AudioPlayer";
import CharacterBadge from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import FileDropZone from "../components/shared/FileDropZone";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Dialog";
import Select from "../components/ui/Select";
import Slider from "../components/ui/Slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { useVoiceStore } from "../stores/useVoiceStore";
import { API_ORIGIN } from "../utils/api";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";

const GENDER_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "female", label: "Female（女声）" },
  { value: "male", label: "Male（男声）" },
];

const AGE_OPTIONS = [
  { value: "",        label: "未指定" },
  { value: "child",  label: "Child（儿童）" },
  { value: "young",  label: "Young（青年）" },
  { value: "middle", label: "Middle-aged（中年）" },
  { value: "old",    label: "Old（老年）" },
];

const PITCH_OPTIONS = [
  { value: "",      label: "未指定" },
  { value: "low",   label: "Low（低沉）" },
  { value: "medium", label: "Medium（适中）" },
  { value: "high",  label: "High（高亢）" },
];

const STYLE_OPTIONS = [
  { value: "",          label: "未指定" },
  { value: "calm",      label: "Calm（平静）" },
  { value: "gentle",    label: "Gentle（温柔）" },
  { value: "assertive", label: "Assertive（坚定）" },
  { value: "lively",    label: "Lively（活泼）" },
  { value: "whisper",   label: "Whisper（低语）" },
  { value: "dramatic",  label: "Dramatic（戏剧）" },
];

const BACKEND_OPTIONS = [
  { value: "omnivoice", label: "OmniVoice" },
  { value: "voxcpm2", label: "VoxCPM2" },
];

const DEFAULT_OMNIVOICE_PROFILE = {
  voice_mode: "design",
  ref_audio_path: "",
  ref_text: "",
  gender: "",
  age: "",
  pitch: "",
  style: "",
  accent: "",
  dialect: "",
  custom_instruct: "",
  speed: 1.0,
  clone_denoise: true,
  clone_num_step: 32,
  clone_guidance_scale: 2.0,
};

const DEFAULT_VOXCPM2_PROFILE = {
  voice_mode: "design",
  design_instruction: "",
  control_instruction: "",
  ref_audio_path: "",
  ref_text: "",
  use_hifi_clone: false,
  cfg_value: 2.0,
  inference_timesteps: 10,
  denoise: false,
};

function buildLegacyInstructionFromPreset(preset = {}) {
  return [
    preset.gender,
    preset.age,
    preset.pitch,
    preset.style,
    preset.accent,
    preset.dialect,
    preset.custom_instruct,
  ].filter(Boolean).join(", ");
}

function resolveOmniProfile(preset = {}) {
  const profile = preset?.backend_profiles?.omnivoice || {};
  return {
    ...DEFAULT_OMNIVOICE_PROFILE,
    ...profile,
    voice_mode: profile.voice_mode || preset.voice_mode || "design",
    ref_audio_path: profile.ref_audio_path ?? preset.ref_audio_path ?? "",
    ref_text: profile.ref_text ?? preset.ref_text ?? "",
    gender: profile.gender ?? preset.gender ?? "",
    age: profile.age ?? preset.age ?? "",
    pitch: profile.pitch ?? preset.pitch ?? "",
    style: profile.style ?? preset.style ?? "",
    accent: profile.accent ?? preset.accent ?? "",
    dialect: profile.dialect ?? preset.dialect ?? "",
    custom_instruct: profile.custom_instruct ?? preset.custom_instruct ?? "",
    speed: Number(profile.speed ?? preset.speed ?? 1),
    clone_denoise: profile.clone_denoise ?? preset.clone_denoise ?? true,
    clone_num_step: Number(profile.clone_num_step ?? preset.clone_num_step ?? 32),
    clone_guidance_scale: Number(profile.clone_guidance_scale ?? preset.clone_guidance_scale ?? 2),
  };
}

function resolveVoxProfile(preset = {}) {
  const profile = preset?.backend_profiles?.voxcpm2 || {};
  return {
    ...DEFAULT_VOXCPM2_PROFILE,
    ...profile,
    voice_mode: profile.voice_mode || preset.voice_mode || "design",
    design_instruction: (profile.design_instruction ?? buildLegacyInstructionFromPreset(preset) ?? "").trim(),
    control_instruction: (profile.control_instruction ?? profile.design_instruction ?? buildLegacyInstructionFromPreset(preset) ?? "").trim(),
    ref_audio_path: profile.ref_audio_path ?? preset.ref_audio_path ?? "",
    ref_text: profile.ref_text ?? preset.ref_text ?? "",
    use_hifi_clone: Boolean(profile.use_hifi_clone ?? false),
    cfg_value: profile.cfg_value == null ? 2.0 : Number(profile.cfg_value),
    inference_timesteps: profile.inference_timesteps == null ? 10 : Number(profile.inference_timesteps),
    denoise: profile.denoise == null ? false : Boolean(profile.denoise),
  };
}

function getProfileModeFromPreset(preset = {}, backend = "omnivoice") {
  const normalized = (backend || "omnivoice").toLowerCase();
  if (normalized === "voxcpm2") {
    return preset?.backend_profiles?.voxcpm2?.voice_mode || preset?.voice_mode || "design";
  }
  return preset?.backend_profiles?.omnivoice?.voice_mode || preset?.voice_mode || "design";
}

function getProfileModeFromPayload(payload = {}, backend = "omnivoice") {
  const normalized = (backend || "omnivoice").toLowerCase();
  if (normalized === "voxcpm2") {
    return payload?.backend_profiles?.voxcpm2?.voice_mode || payload?.voice_mode || "design";
  }
  return payload?.backend_profiles?.omnivoice?.voice_mode || payload?.voice_mode || "design";
}

function buildReferenceAudioUrl(path) {
  const value = (path || "").trim();
  if (!value) return "";
  return `${API_ORIGIN}/api/v1/voices/reference-audio?path=${encodeURIComponent(value)}`;
}

function ReferenceAudioPlayer({ audioPath }) {
  const audioUrl = buildReferenceAudioUrl(audioPath);
  if (!audioUrl) return null;
  return <AudioPlayer audioUrl={audioUrl} height={44} compact />;
}

const emptyForm = {
  name: "",
  voice_mode: "design",
  description: "",
  gender: "",
  age: "",
  pitch: "",
  style: "",
  accent: "",
  dialect: "",
  custom_instruct: "",
  speed: 1.0,
  clone_denoise: true,
  clone_num_step: 32,
  clone_guidance_scale: 2.0,
  backend_profiles: {
    omnivoice: { ...DEFAULT_OMNIVOICE_PROFILE },
    voxcpm2: { ...DEFAULT_VOXCPM2_PROFILE },
  },
};

function SortablePresetCard({
  preset,
  isSelected,
  onToggleSelect,
  onPreview,
  onDelete,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
  };

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
      <span className={`presetModeBadge ${preset.voice_mode}`}>{preset.voice_mode}</span>
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

export default function VoiceConfigPage() {
  const { currentProject, currentProjectFileHandle, bindCurrentProjectFile, refreshCurrentProject } = useProjectStore();
  const { script } = useScriptStore();
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);
  const {
    presets, assignments, previewAudioUrl, previewAudioBlob, previewMeta,
    isLoading, isSaving, isTranscribing, error,
    setAssignments, assignVoice, loadPresets,
    createPreset, updatePreset, deletePreset, reorderPresets, saveAssignments, previewVoice,
    uploadReferenceAudio, transcribeAudio,
  } = useVoiceStore();

  const [form, setForm] = useState({ ...emptyForm });
  const [activeBackend, setActiveBackend] = useState("omnivoice");
  const [previewBackend, setPreviewBackend] = useState("omnivoice");
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [sampleText, setSampleText] = useState("这是试听文本，用于确认角色声音风格。");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    loadPresets().catch(() => undefined);
  }, [loadPresets]);

  useEffect(() => {
    setAssignments(currentProject?.voice_assignments || {});
  }, [currentProject, setAssignments]);

  const characters = useMemo(() => {
    const effectiveScript =
      (Array.isArray(script?.segments) && script.segments.length ? script : null)
      || (currentProject?.script || null);
    if (!effectiveScript) {
      return [];
    }

    const segmentCounts = new Map();
    for (const segment of effectiveScript.segments || []) {
      const name = (segment?.speaker || "").trim() || "narrator";
      segmentCounts.set(name, (segmentCounts.get(name) || 0) + 1);
    }

    const merged = new Map();
    for (const [name, count] of segmentCounts.entries()) {
      merged.set(name, { name, appearance_count: count });
    }
    for (const character of effectiveScript.characters || []) {
      const name = (character?.name || "").trim();
      if (!name) {
        continue;
      }
      if (!merged.has(name)) {
        merged.set(name, {
          name,
          appearance_count: Number(character?.appearance_count || 0) || 0,
        });
      }
    }

    return Array.from(merged.values()).sort((a, b) => (b.appearance_count || 0) - (a.appearance_count || 0));
  }, [script, currentProject?.script]);
  const presetOptions = useMemo(
    () => [{ value: "", label: "未分配" }, ...presets.map((p) => ({ value: p.id, label: p.name }))],
    [presets]
  );
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const presetIds = useMemo(() => presets.map((preset) => preset.id), [presets]);
  const isEditMode = Boolean(selectedPresetId && selectedPreset);

  useEffect(() => {
    if (!selectedPreset) {
      return;
    }
    const omnivoiceProfile = resolveOmniProfile(selectedPreset);
    const voxcpm2Profile = resolveVoxProfile(selectedPreset);
    setForm({
      ...emptyForm,
      ...selectedPreset,
      voice_mode: omnivoiceProfile.voice_mode || selectedPreset.voice_mode || "design",
      speed: Number(omnivoiceProfile.speed ?? selectedPreset.speed ?? 1),
      clone_denoise: omnivoiceProfile.clone_denoise ?? true,
      clone_num_step: Number(omnivoiceProfile.clone_num_step ?? 32),
      clone_guidance_scale: Number(omnivoiceProfile.clone_guidance_scale ?? 2.0),
      backend_profiles: {
        omnivoice: omnivoiceProfile,
        voxcpm2: voxcpm2Profile,
      },
    });
  }, [selectedPreset]);

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function setBackendField(backend, key, value) {
    setForm((prev) => ({
      ...prev,
      backend_profiles: {
        ...prev.backend_profiles,
        [backend]: {
          ...(prev.backend_profiles?.[backend] || {}),
          [key]: value,
        },
      },
    }));
  }

  function setBackendVoiceMode(backend, value) {
    setForm((prev) => ({
      ...prev,
      voice_mode: value,
      backend_profiles: {
        ...prev.backend_profiles,
        [backend]: {
          ...(prev.backend_profiles?.[backend] || {}),
          voice_mode: value,
        },
      },
    }));
  }

  function buildPresetPayload() {
    const omnivoiceProfile = {
      ...DEFAULT_OMNIVOICE_PROFILE,
      ...(form.backend_profiles?.omnivoice || {}),
      voice_mode: form.backend_profiles?.omnivoice?.voice_mode || "design",
      speed: Number(form.backend_profiles?.omnivoice?.speed ?? 1) || 1,
      clone_num_step: Math.max(1, Math.min(128, Math.round(Number(form.backend_profiles?.omnivoice?.clone_num_step ?? 32) || 32))),
      clone_guidance_scale: Math.max(0, Math.min(10, Number(form.backend_profiles?.omnivoice?.clone_guidance_scale ?? 2) || 2)),
      clone_denoise: Boolean(form.backend_profiles?.omnivoice?.clone_denoise ?? true),
      ref_audio_path: (form.backend_profiles?.omnivoice?.ref_audio_path || "").trim(),
      ref_text: (form.backend_profiles?.omnivoice?.ref_text || "").trim(),
      custom_instruct: (form.backend_profiles?.omnivoice?.custom_instruct || "").trim(),
      accent: (form.backend_profiles?.omnivoice?.accent || "").trim(),
      dialect: (form.backend_profiles?.omnivoice?.dialect || "").trim(),
    };
    const voxcpm2Profile = {
      ...DEFAULT_VOXCPM2_PROFILE,
      ...(form.backend_profiles?.voxcpm2 || {}),
      voice_mode: form.backend_profiles?.voxcpm2?.voice_mode || "design",
      design_instruction: (form.backend_profiles?.voxcpm2?.design_instruction || "").trim(),
      control_instruction: (form.backend_profiles?.voxcpm2?.control_instruction || "").trim(),
      ref_audio_path: (form.backend_profiles?.voxcpm2?.ref_audio_path || "").trim(),
      ref_text: (form.backend_profiles?.voxcpm2?.ref_text || "").trim(),
      use_hifi_clone: Boolean(form.backend_profiles?.voxcpm2?.use_hifi_clone),
      cfg_value: Math.max(0.1, Number(form.backend_profiles?.voxcpm2?.cfg_value ?? 2.0) || 2.0),
      inference_timesteps: Math.max(1, Math.min(100, Math.round(Number(form.backend_profiles?.voxcpm2?.inference_timesteps ?? 10) || 10))),
      denoise: Boolean(form.backend_profiles?.voxcpm2?.denoise),
    };

    if (omnivoiceProfile.voice_mode !== "clone") {
      omnivoiceProfile.ref_audio_path = "";
      omnivoiceProfile.ref_text = "";
      omnivoiceProfile.clone_denoise = true;
      omnivoiceProfile.clone_num_step = 32;
      omnivoiceProfile.clone_guidance_scale = 2.0;
    }
    if (voxcpm2Profile.voice_mode !== "clone") {
      voxcpm2Profile.ref_audio_path = "";
      voxcpm2Profile.ref_text = "";
      voxcpm2Profile.use_hifi_clone = false;
    }

    const payload = {
      ...form,
      name: form.name.trim(),
      voice_mode: form.voice_mode || omnivoiceProfile.voice_mode,
      speed: omnivoiceProfile.speed,
      gender: omnivoiceProfile.gender || "",
      age: omnivoiceProfile.age || "",
      pitch: omnivoiceProfile.pitch || "",
      style: omnivoiceProfile.style || "",
      accent: omnivoiceProfile.accent || "",
      dialect: omnivoiceProfile.dialect || "",
      custom_instruct: omnivoiceProfile.custom_instruct || "",
      ref_audio_path: omnivoiceProfile.voice_mode === "clone" ? (omnivoiceProfile.ref_audio_path || null) : null,
      ref_text: omnivoiceProfile.voice_mode === "clone" ? (omnivoiceProfile.ref_text || null) : null,
      clone_denoise: omnivoiceProfile.voice_mode === "clone" ? Boolean(omnivoiceProfile.clone_denoise) : null,
      clone_num_step: omnivoiceProfile.voice_mode === "clone" ? omnivoiceProfile.clone_num_step : null,
      clone_guidance_scale: omnivoiceProfile.voice_mode === "clone" ? omnivoiceProfile.clone_guidance_scale : null,
      backend_profiles: {
        omnivoice: omnivoiceProfile,
        voxcpm2: voxcpm2Profile,
      },
    };
    return payload;
  }

  async function handleSavePreset() {
    if (!form.name.trim()) return;
    const payload = buildPresetPayload();
    const preset = isEditMode
      ? await updatePreset(selectedPresetId, payload)
      : await createPreset(payload);
    setForm({ ...emptyForm });
    setActiveBackend("omnivoice");
    setSelectedPresetId(preset.id);
  }

  async function handleSaveAssignments() {
    if (!currentProject?.id) return;
    await saveAssignments(currentProject.id);
    await refreshCurrentProject(currentProject.id);
  }

  async function handlePreview() {
    if (!selectedPreset) return;
    const previewPreset = {
      ...buildPresetPayload(),
      id: selectedPreset.id,
    };
    await previewVoice({
      preset: previewPreset,
      text: sampleText,
      ttsBackend: previewBackend,
      sourceMode: getProfileModeFromPayload(previewPreset, previewBackend),
    });
  }

  async function handlePreviewPreset(preset) {
    setSampleText("这是试听文本");
    setSelectedPresetId(preset.id);
    await previewVoice({
      preset,
      text: "这是试听文本",
      ttsBackend: previewBackend,
      sourceMode: getProfileModeFromPreset(preset, previewBackend),
    });
  }

  async function handleSyncPreviewToOtherBackend() {
    if ((!previewAudioUrl && !previewAudioBlob) || !selectedPreset) {
      useUiStore.getState().pushToast({ title: "请先生成试听音频", tone: "error" });
      return;
    }
    if (previewMeta?.backend && previewMeta.backend !== previewBackend) {
      useUiStore.getState().pushToast({
        title: "当前试听后端已切换，请先在当前 tab 重新生成试听后再同步",
        tone: "error",
      });
      return;
    }
    const sourceBackend = (previewMeta?.backend || previewBackend || "omnivoice").toLowerCase();
    const targetBackend = sourceBackend === "voxcpm2" ? "omnivoice" : "voxcpm2";
    const sourceMode = previewMeta?.source_mode || getProfileModeFromPreset(selectedPreset, sourceBackend) || "design";
    const referenceText = (previewMeta?.text || sampleText || "").trim();
    try {
      const blob = previewAudioBlob || (await (async () => {
        const response = await fetch(previewAudioUrl);
        if (!response.ok) {
          throw new Error(`读取试听音频失败: HTTP ${response.status}`);
        }
        return response.blob();
      })());
      const file = new File([blob], `preview_sync_${sourceBackend}_${Date.now()}.wav`, {
        type: "audio/wav",
      });
      const uploaded = await uploadReferenceAudio(file);
      const refAudioPath = uploaded?.file_path || "";
      if (!refAudioPath) {
        throw new Error("上传试听音频后未返回有效路径");
      }
      setForm((prev) => {
        const next = {
          ...prev,
          // 同步只迁移目标 backend 的克隆配置，不改变预设卡片标签。
          voice_mode: prev.voice_mode || sourceMode,
          backend_profiles: {
            ...prev.backend_profiles,
            [targetBackend]: {
              ...(prev.backend_profiles?.[targetBackend] || {}),
              // 同步过程使用 clone 语义将源音色迁移到目标后端。
              voice_mode: "clone",
              ref_audio_path: refAudioPath,
              ref_text: referenceText,
            },
          },
        };
        if (targetBackend === "voxcpm2" && next.backend_profiles?.voxcpm2) {
          next.backend_profiles.voxcpm2.use_hifi_clone = Boolean(next.backend_profiles.voxcpm2.use_hifi_clone);
        }
        return next;
      });
      setActiveBackend(targetBackend);
      useUiStore.getState().pushToast({
        title: `已同步到 ${targetBackend === "voxcpm2" ? "VoxCPM2" : "OmniVoice"} profile（已填充 clone 参数，点击“更新预设”保存）`,
        tone: "success",
      });
    } catch (error) {
      useUiStore.getState().pushToast({
        title: `同步失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  async function handleRefAudioUpload(file, backend) {
    const result = await uploadReferenceAudio(file);
    const filePath = result?.file_path || "";
    if (!filePath) {
      return;
    }
    setBackendField(backend, "ref_audio_path", filePath);
  }

  async function handleTranscribe(backend) {
    const audioPath = form.backend_profiles?.[backend]?.ref_audio_path || "";
    if (!audioPath) return;
    const result = await transcribeAudio(audioPath);
    setBackendField(backend, "ref_text", result?.text || "");
  }

  async function handlePresetDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = presetIds.indexOf(active.id);
    const newIndex = presetIds.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const nextOrder = arrayMove(presetIds, oldIndex, newIndex);
    await reorderPresets(nextOrder);
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    const forceSaveAs = Boolean(options?.forceSaveAs);
    if (!currentProject) {
      return;
    }
    const payload = buildProjectFilePayload({
      project: currentProject,
      script,
      sourceText: script?.source_text || "",
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
      useUiStore.getState().pushToast({
        title: `保存项目失败：${error?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }, [currentProject, script, currentProjectFileHandle, bindCurrentProjectFile]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  return (
    <div className="pageGrid twoCols">
      {/* LEFT: Preset management */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* New preset form */}
        <GlassCard>
          <h2 className="cardTitle"><Mic size={16} /> 新建声音预设</h2>

          <div className="editorGrid">
            <input
              className="textInput"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="预设名称（必填）"
              onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
            />
            <Select
              value={activeBackend}
              onValueChange={(v) => setActiveBackend(v)}
              options={BACKEND_OPTIONS}
            />
          </div>

          <Tabs value={activeBackend} onValueChange={(v) => setActiveBackend(v)}>
            <TabsList>
              <TabsTrigger value="omnivoice">OmniVoice Profile</TabsTrigger>
              <TabsTrigger value="voxcpm2">VoxCPM2 Profile</TabsTrigger>
            </TabsList>

            <TabsContent value="omnivoice" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
              <Tabs
                value={form.backend_profiles?.omnivoice?.voice_mode || "design"}
                onValueChange={(v) => setBackendVoiceMode("omnivoice", v)}
              >
                <TabsList>
                  <TabsTrigger value="design">声音设计</TabsTrigger>
                  <TabsTrigger value="clone">声音克隆</TabsTrigger>
                  <TabsTrigger value="auto">自动</TabsTrigger>
                </TabsList>

                <TabsContent value="design" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
                  <div className="editorGrid">
                    <div className="formGroup">
                      <label className="formLabel">性别</label>
                      <Select
                        value={form.backend_profiles?.omnivoice?.gender || ""}
                        onValueChange={(v) => setBackendField("omnivoice", "gender", v)}
                        options={GENDER_OPTIONS}
                        placeholder="未指定"
                      />
                    </div>
                    <div className="formGroup">
                      <label className="formLabel">年龄</label>
                      <Select
                        value={form.backend_profiles?.omnivoice?.age || ""}
                        onValueChange={(v) => setBackendField("omnivoice", "age", v)}
                        options={AGE_OPTIONS}
                        placeholder="未指定"
                      />
                    </div>
                  </div>
                  <div className="editorGrid">
                    <div className="formGroup">
                      <label className="formLabel">音调</label>
                      <Select
                        value={form.backend_profiles?.omnivoice?.pitch || ""}
                        onValueChange={(v) => setBackendField("omnivoice", "pitch", v)}
                        options={PITCH_OPTIONS}
                        placeholder="未指定"
                      />
                    </div>
                    <div className="formGroup">
                      <label className="formLabel">风格</label>
                      <Select
                        value={form.backend_profiles?.omnivoice?.style || ""}
                        onValueChange={(v) => setBackendField("omnivoice", "style", v)}
                        options={STYLE_OPTIONS}
                        placeholder="未指定"
                      />
                    </div>
                  </div>
                  <div className="editorGrid">
                    <div className="formGroup">
                      <label className="formLabel">口音（可选）</label>
                      <input
                        className="textInput"
                        value={form.backend_profiles?.omnivoice?.accent || ""}
                        onChange={(e) => setBackendField("omnivoice", "accent", e.target.value)}
                        placeholder="例如：美式、英式、川渝口音"
                      />
                    </div>
                    <div className="formGroup">
                      <label className="formLabel">方言（可选）</label>
                      <input
                        className="textInput"
                        value={form.backend_profiles?.omnivoice?.dialect || ""}
                        onChange={(e) => setBackendField("omnivoice", "dialect", e.target.value)}
                        placeholder="例如：吴语、粤语、闽南语"
                      />
                    </div>
                  </div>
                  <div className="formGroup">
                    <label className="formLabel">自定义描述</label>
                    <textarea
                      className="textArea compactArea"
                      value={form.backend_profiles?.omnivoice?.custom_instruct || ""}
                      onChange={(e) => setBackendField("omnivoice", "custom_instruct", e.target.value)}
                      placeholder="例如：说话温柔，略带忧伤的年轻女性，有古典气质"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="clone" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
                  <FileDropZone
                    accept="audio/*"
                    onFile={(file) => handleRefAudioUpload(file, "omnivoice")}
                    label="上传参考音频"
                    sublabel="支持 MP3 / WAV / FLAC，建议 3-30 秒"
                  />
                  {form.backend_profiles?.omnivoice?.ref_audio_path ? (
                    <div className="controlRow">
                      <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ✓ {(form.backend_profiles?.omnivoice?.ref_audio_path || "").split(/[\\/]/).pop()}
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => handleTranscribe("omnivoice")} disabled={isSaving || isTranscribing}>
                        {isTranscribing ? "转写中..." : "ASR 转写"}
                      </Button>
                    </div>
                  ) : null}
                  <div className="formGroup">
                    <label className="formLabel">参考音频路径</label>
                    <input
                      className="textInput"
                      value={form.backend_profiles?.omnivoice?.ref_audio_path || ""}
                      onChange={(e) => setBackendField("omnivoice", "ref_audio_path", e.target.value)}
                      placeholder="可手工输入本地路径"
                    />
                  </div>
                  <ReferenceAudioPlayer audioPath={form.backend_profiles?.omnivoice?.ref_audio_path} />
                  <div className="formGroup">
                    <label className="formLabel">参考文本（转写或手动输入）</label>
                    <textarea
                      className="textArea compactArea"
                      value={form.backend_profiles?.omnivoice?.ref_text || ""}
                      onChange={(e) => setBackendField("omnivoice", "ref_text", e.target.value)}
                      placeholder="参考音频的对应文本内容..."
                    />
                  </div>
                  <details style={{ border: "1px solid var(--lineSoft)", borderRadius: 10, padding: "8px 10px" }}>
                    <summary style={{ cursor: "pointer", color: "var(--textMain)" }}>
                      高级默认推理参数（可选，仅克隆模式）
                    </summary>
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <label className="checkRow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form.backend_profiles?.omnivoice?.clone_denoise)}
                          onChange={(e) => setBackendField("omnivoice", "clone_denoise", e.target.checked)}
                        />
                        <span>默认 denoise</span>
                      </label>
                      <div className="editorGrid">
                        <div className="formGroup">
                          <label className="formLabel">默认 num_step (1-128)</label>
                          <input
                            className="textInput"
                            type="number"
                            min={1}
                            max={128}
                            step={1}
                            value={Number(form.backend_profiles?.omnivoice?.clone_num_step ?? 32)}
                            onChange={(e) => setBackendField("omnivoice", "clone_num_step", e.target.value)}
                          />
                        </div>
                        <div className="formGroup">
                          <label className="formLabel">默认 guidance_scale (0-10)</label>
                          <input
                            className="textInput"
                            type="number"
                            min={0}
                            max={10}
                            step={0.1}
                            value={Number(form.backend_profiles?.omnivoice?.clone_guidance_scale ?? 2)}
                            onChange={(e) => setBackendField("omnivoice", "clone_guidance_scale", e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        优先级：片段 tts_overrides {'>'} 预设高级默认 {'>'} 项目合成配置。
                      </p>
                    </div>
                  </details>
                </TabsContent>

                <TabsContent value="auto" style={{ paddingTop: 12 }}>
                  <p className="muted">Auto 模式下，OmniVoice 将使用模型默认声音。</p>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="voxcpm2" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
              <Tabs
                value={form.backend_profiles?.voxcpm2?.voice_mode || "design"}
                onValueChange={(v) => setBackendVoiceMode("voxcpm2", v)}
              >
                <TabsList>
                  <TabsTrigger value="design">声音设计</TabsTrigger>
                  <TabsTrigger value="clone">声音克隆</TabsTrigger>
                  <TabsTrigger value="auto">自动</TabsTrigger>
                </TabsList>

                <TabsContent value="design" style={{ display: "grid", gap: 10, paddingTop: 12 }}>
                  <div className="formGroup">
                    <label className="formLabel">Design Instruction</label>
                    <textarea
                      className="textArea compactArea"
                      value={form.backend_profiles?.voxcpm2?.design_instruction || ""}
                      onChange={(e) => setBackendField("voxcpm2", "design_instruction", e.target.value)}
                      placeholder="例如：年轻女性，温柔甜美，轻微播音腔"
                    />
                  </div>
                  <div className="editorGrid">
                    <div className="formGroup">
                      <label className="formLabel">默认 cfg_value</label>
                      <input
                        className="textInput"
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={Number(form.backend_profiles?.voxcpm2?.cfg_value ?? 2)}
                        onChange={(e) => setBackendField("voxcpm2", "cfg_value", e.target.value)}
                      />
                    </div>
                    <div className="formGroup">
                      <label className="formLabel">默认 inference_timesteps</label>
                      <input
                        className="textInput"
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        value={Number(form.backend_profiles?.voxcpm2?.inference_timesteps ?? 10)}
                        onChange={(e) => setBackendField("voxcpm2", "inference_timesteps", e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="checkRow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.backend_profiles?.voxcpm2?.denoise)}
                      onChange={(e) => setBackendField("voxcpm2", "denoise", e.target.checked)}
                    />
                    <span>默认 denoise</span>
                  </label>
                </TabsContent>

                <TabsContent value="clone" style={{ display: "grid", gap: 10, paddingTop: 12 }}>
                  <FileDropZone
                    accept="audio/*"
                    onFile={(file) => handleRefAudioUpload(file, "voxcpm2")}
                    label="上传参考音频"
                    sublabel="VoxCPM2 clone/hifi clone 使用"
                  />
                  <div className="formGroup">
                    <label className="formLabel">Control Instruction</label>
                    <textarea
                      className="textArea compactArea"
                      value={form.backend_profiles?.voxcpm2?.control_instruction || ""}
                      onChange={(e) => setBackendField("voxcpm2", "control_instruction", e.target.value)}
                      placeholder="例如：更悲伤，语速稍慢，表达克制但带颤音"
                    />
                  </div>
                  {form.backend_profiles?.voxcpm2?.ref_audio_path ? (
                    <div className="controlRow">
                      <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ✓ {(form.backend_profiles?.voxcpm2?.ref_audio_path || "").split(/[\\/]/).pop()}
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => handleTranscribe("voxcpm2")} disabled={isSaving || isTranscribing}>
                        {isTranscribing ? "转写中..." : "ASR 转写"}
                      </Button>
                    </div>
                  ) : null}
                  <div className="formGroup">
                    <label className="formLabel">参考音频路径</label>
                    <input
                      className="textInput"
                      value={form.backend_profiles?.voxcpm2?.ref_audio_path || ""}
                      onChange={(e) => setBackendField("voxcpm2", "ref_audio_path", e.target.value)}
                      placeholder="可手工输入本地路径"
                    />
                  </div>
                  <ReferenceAudioPlayer audioPath={form.backend_profiles?.voxcpm2?.ref_audio_path} />
                  <div className="formGroup">
                    <label className="formLabel">Prompt Text（Hi-Fi clone 可选）</label>
                    <textarea
                      className="textArea compactArea"
                      value={form.backend_profiles?.voxcpm2?.ref_text || ""}
                      onChange={(e) => setBackendField("voxcpm2", "ref_text", e.target.value)}
                      placeholder="参考音频对应文本"
                    />
                  </div>
                  <label className="checkRow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.backend_profiles?.voxcpm2?.use_hifi_clone)}
                      onChange={(e) => setBackendField("voxcpm2", "use_hifi_clone", e.target.checked)}
                    />
                    <span>启用 Hi-Fi Clone（会使用 prompt_wav_path + prompt_text）</span>
                  </label>
                  <div className="editorGrid">
                    <div className="formGroup">
                      <label className="formLabel">默认 cfg_value</label>
                      <input
                        className="textInput"
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={Number(form.backend_profiles?.voxcpm2?.cfg_value ?? 2)}
                        onChange={(e) => setBackendField("voxcpm2", "cfg_value", e.target.value)}
                      />
                    </div>
                    <div className="formGroup">
                      <label className="formLabel">默认 inference_timesteps</label>
                      <input
                        className="textInput"
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        value={Number(form.backend_profiles?.voxcpm2?.inference_timesteps ?? 10)}
                        onChange={(e) => setBackendField("voxcpm2", "inference_timesteps", e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="checkRow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.backend_profiles?.voxcpm2?.denoise)}
                      onChange={(e) => setBackendField("voxcpm2", "denoise", e.target.checked)}
                    />
                    <span>默认 denoise</span>
                  </label>
                </TabsContent>

                <TabsContent value="auto" style={{ paddingTop: 12 }}>
                  <p className="muted">Auto 模式下，VoxCPM2 将使用模型默认行为。</p>
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>

          <Slider
            label="语速"
            value={[Number(form.backend_profiles?.omnivoice?.speed ?? 1)]}
            onValueChange={([v]) => setBackendField("omnivoice", "speed", v)}
            min={0.5}
            max={2.0}
            step={0.05}
            unit="x"
          />

          <div className="formGroup">
            <label className="formLabel">描述（可选）</label>
            <textarea
              className="textArea compactArea"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="记录这个声音适合的角色气质..."
            />
          </div>

          <div className="controlRow">
            <Button
              variant="primary"
              icon={Plus}
              disabled={isSaving || !form.name.trim()}
              onClick={handleSavePreset}
            >
              {isSaving ? "保存中..." : isEditMode ? "更新预设" : "创建预设"}
            </Button>
            {isEditMode ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedPresetId(null);
                  setForm({ ...emptyForm });
                  setActiveBackend("omnivoice");
                }}
              >
                取消编辑
              </Button>
            ) : null}
            <span className="muted">
              {isLoading ? "加载中..." : `已有 ${presets.length} 个预设`}
            </span>
          </div>

          {error && <div className="errorText">⚠ {error}</div>}
        </GlassCard>

        {/* Preset grid */}
        <GlassCard>
          <h2 className="cardTitle">声音预设</h2>
          <p className="cardSubtitle">可拖拽调整预设顺序，新的顺序会自动保存。</p>
          {presets.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePresetDragEnd}>
              <SortableContext items={presetIds} strategy={rectSortingStrategy}>
                <div className="presetGrid">
                  {presets.map((preset) => (
                    <SortablePresetCard
                      key={preset.id}
                      preset={preset}
                      isSelected={selectedPresetId === preset.id}
                      onToggleSelect={() => {
                        if (preset.id === selectedPresetId) {
                          setSelectedPresetId(null);
                          setForm({ ...emptyForm });
                          setActiveBackend("omnivoice");
                          return;
                        }
                        setSelectedPresetId(preset.id);
                      }}
                      onDelete={() => setDeleteTarget(preset.id)}
                      onPreview={() => handlePreviewPreset(preset)}
                    />
                  ))}
                  {/* Add new card */}
                  <div
                    className="presetCard"
                    style={{ borderStyle: "dashed", cursor: "pointer", alignItems: "center", justifyContent: "center", minHeight: 140 }}
                    onClick={() => {
                      setSelectedPresetId(null);
                      setForm({ ...emptyForm });
                      setActiveBackend("omnivoice");
                    }}
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
      </div>

      {/* RIGHT: Assignment + preview */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Preview player */}
        {selectedPreset && (
          <GlassCard>
            <h2 className="cardTitle">试听预览 · {selectedPreset.name}</h2>
            <Tabs value={previewBackend} onValueChange={(v) => setPreviewBackend(v)}>
              <TabsList>
                <TabsTrigger value="omnivoice">OmniVoice</TabsTrigger>
                <TabsTrigger value="voxcpm2">VoxCPM2</TabsTrigger>
              </TabsList>
            </Tabs>
            <textarea
              className="textArea compactArea"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
            />
            <div className="controlRow">
              <Button variant="primary" onClick={handlePreview} disabled={isSaving}>
                {isSaving ? "合成中..." : "▶ 试听"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleSyncPreviewToOtherBackend}
                disabled={isSaving || (!previewAudioUrl && !previewAudioBlob)}
              >
                {previewBackend === "voxcpm2" ? "同步到 OmniVoice" : "同步到 VoxCPM2"}
              </Button>
            </div>
            {previewAudioUrl && <AudioPlayer audioUrl={previewAudioUrl} audioBlob={previewAudioBlob} />}
          </GlassCard>
        )}

        {/* Character assignment */}
        <GlassCard>
          <h2 className="cardTitle">角色分配</h2>
          <p className="cardSubtitle">为项目中每个角色选择对应的声音预设。</p>

          {characters.length ? (
            <div className="listStack">
              {characters.map((char) => (
                <div key={char.name} className="statRow" style={{ gap: 12, flexWrap: "wrap" }}>
                  <CharacterBadge name={char.name} />
                  <span className="muted" style={{ marginRight: "auto" }}>出场 {char.appearance_count} 次</span>
                  <div style={{ minWidth: 180 }}>
                    <Select
                      value={assignments[char.name] || ""}
                      onValueChange={(v) => assignVoice(char.name, v)}
                      options={presetOptions}
                      placeholder="未分配"
                    />
                  </div>
                </div>
              ))}
              <div className="controlRow" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                <Button
                  variant="primary"
                  disabled={!currentProject?.id || isSaving}
                  onClick={handleSaveAssignments}
                >
                  保存角色分配
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="当前项目无角色"
              description="请先在「文本输入」完成 LLM 解析"
            />
          )}
        </GlassCard>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="删除声音预设"
        description="此操作不可撤销，所有使用该预设的角色分配也将被清除。"
        onConfirm={() => { deletePreset(deleteTarget); setDeleteTarget(null); if (selectedPresetId === deleteTarget) setSelectedPresetId(null); }}
        danger
      />
    </div>
  );
}
