import { Bot, ChevronDown, ChevronUp, Download, LoaderCircle, Music, Pause, Pencil, Play, RefreshCw, Save, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AudioPlayer from "../components/shared/AudioPlayer";
import GlassCard from "../components/shared/GlassCard";
import StatusBadge from "../components/shared/StatusBadge";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { useWebSocket } from "../hooks/useWebSocket";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { API_ORIGIN, api, getWsBaseUrl } from "../utils/api";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import { getErrorMessage } from "../utils/errors";
import { useI18n } from "../i18n/I18nProvider";

const DEFAULT_FORM = {
  task_type: "text2music",
  prompt: "",
  lyrics: "",
  audio_duration: 30,
  vocal_language: "unknown",
  num_inference_steps: 8,
  seed: "",
  source_asset_name: "",
  reference_asset_name: "",
  bpm: "",
  keyscale: "",
  timesignature: "",
  track_name: "",
  complete_track_classes: "",
  repainting_start: "",
  repainting_end: "",
  audio_cover_strength: "1.0",
  guidance_scale: "7.0",
  shift: "3.0",
};

const ACTIVE_STATUSES = new Set(["queued", "running", "cancel_requested"]);

const STATUS_META = {
  idle: { label: "music.status.idle", tone: "default" },
  queued: { label: "music.status.queued", tone: "warning" },
  running: { label: "music.status.running", tone: "warning" },
  cancel_requested: { label: "music.status.cancelRequested", tone: "warning" },
  done: { label: "music.status.done", tone: "success" },
  canceled: { label: "music.status.canceled", tone: "default" },
  error: { label: "music.status.error", tone: "warning" },
};

const buildLanguageOptions = (t) => ([
  { value: "unknown", label: t("music.option.languageUnknown") },
  { value: "zh", label: t("music.option.languageZh") },
  { value: "en", label: t("music.option.languageEn") },
  { value: "ja", label: t("music.option.languageJa") },
  { value: "ko", label: t("music.option.languageKo") },
]);

const buildTurboShiftOptions = (t) => ([
  { value: "1.0", label: t("music.option.shift10") },
  { value: "2.0", label: t("music.option.shift20") },
  { value: "3.0", label: t("music.option.shift30") },
]);
const BASE_MIN_INFERENCE_STEPS = 32;
const BASE_MAX_INFERENCE_STEPS = 100;
const TURBO_DEFAULT_INFERENCE_STEPS = 8;
const BASE_DEFAULT_INFERENCE_STEPS = 50;
const MUSIC_CATEGORY_ALL = "all";
const MUSIC_CATEGORY_UNCATEGORIZED = "uncategorized";

const BPM_OPTIONS = [
  { value: "", label: "unspecified" },
  { value: "60", label: "60" },
  { value: "70", label: "70" },
  { value: "80", label: "80" },
  { value: "90", label: "90" },
  { value: "100", label: "100" },
  { value: "110", label: "110" },
  { value: "120", label: "120" },
  { value: "130", label: "130" },
  { value: "140", label: "140" },
  { value: "150", label: "150" },
  { value: "160", label: "160" },
  { value: "180", label: "180" },
];

const KEYSCALE_OPTIONS = [
  { value: "", label: "unspecified" },
  { value: "C major", label: "C major" },
  { value: "G major", label: "G major" },
  { value: "D major", label: "D major" },
  { value: "A major", label: "A major" },
  { value: "E major", label: "E major" },
  { value: "B major", label: "B major" },
  { value: "F# major", label: "F# major" },
  { value: "F major", label: "F major" },
  { value: "Bb major", label: "Bb major" },
  { value: "Eb major", label: "Eb major" },
  { value: "Ab major", label: "Ab major" },
  { value: "A minor", label: "A minor" },
  { value: "E minor", label: "E minor" },
  { value: "B minor", label: "B minor" },
  { value: "F# minor", label: "F# minor" },
  { value: "C# minor", label: "C# minor" },
  { value: "G# minor", label: "G# minor" },
  { value: "D minor", label: "D minor" },
  { value: "G minor", label: "G minor" },
  { value: "C minor", label: "C minor" },
  { value: "F minor", label: "F minor" },
];

const TIMESIGNATURE_OPTIONS = [
  { value: "", label: "unspecified" },
  { value: "4/4", label: "4/4" },
  { value: "3/4", label: "3/4" },
  { value: "2/4", label: "2/4" },
  { value: "6/8", label: "6/8" },
  { value: "12/8", label: "12/8" },
  { value: "5/4", label: "5/4" },
  { value: "7/8", label: "7/8" },
];

const ASSIST_SOURCE_OPTIONS = [
  { value: "secondary_local", label: "secondary_local" },
  { value: "primary_local", label: "primary_local" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
];

const TASK_TYPE_OPTIONS = [
  { value: "text2music", label: "Text2Music" },
  { value: "cover", label: "Cover" },
  { value: "repaint", label: "Repaint" },
  { value: "lego", label: "Lego" },
  { value: "extract", label: "Extract" },
  { value: "complete", label: "Complete" },
];

const MUSIC_MODEL_VARIANT_OPTIONS = [
  { value: "turbo", label: "Turbo" },
  { value: "base", label: "Base" },
];

const buildTrackNameOptions = (t) => ([
  { value: "", label: t("music.option.selectTrack") },
  { value: "vocals", label: "vocals" },
  { value: "drums", label: "drums" },
  { value: "bass", label: "bass" },
  { value: "guitar", label: "guitar" },
  { value: "piano", label: "piano" },
  { value: "strings", label: "strings" },
  { value: "other", label: "other" },
]);

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getDefaultInferenceSteps(modelVariant) {
  return String(modelVariant || "turbo").toLowerCase() === "base"
    ? BASE_DEFAULT_INFERENCE_STEPS
    : TURBO_DEFAULT_INFERENCE_STEPS;
}

function normalizeSelectOptionValue(value, options, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const exact = options.find((item) => item.value === raw);
  if (exact) return exact.value;
  const normalized = raw.toLowerCase();
  const matched = options.find((item) => String(item.value || "").toLowerCase() === normalized);
  return matched ? matched.value : fallback;
}

function normalizeNearestNumericOptionValue(value, options, fallback = "") {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const candidates = options
    .map((item) => Number(item.value))
    .filter((item) => Number.isFinite(item));
  if (candidates.length === 0) {
    return fallback;
  }
  const nearest = candidates.reduce((best, item) => {
    const bestDelta = Math.abs(best - numeric);
    const itemDelta = Math.abs(item - numeric);
    if (itemDelta < bestDelta) return item;
    if (itemDelta === bestDelta && item < best) return item;
    return best;
  }, candidates[0]);
  return String(nearest);
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function inferAssetNameFromResult(result) {
  const outputPath = result?.output_path;
  if (!outputPath) return "";
  const normalized = String(outputPath).replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

function parseMusicEvent(data) {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data === "object") {
    return data;
  }
  return null;
}

function normalizeAssetCategories(rawCategories) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(rawCategories) ? rawCategories : []) {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, builtin: Boolean(item?.builtin) });
  }
  if (!seen.has(MUSIC_CATEGORY_UNCATEGORIZED)) {
    out.unshift({ id: MUSIC_CATEGORY_UNCATEGORIZED, name: "__uncategorized__", builtin: true });
  }
  return out;
}

export default function MusicPage({ onNavigate }) {
  const { t } = useI18n();
  const LANGUAGE_OPTIONS = useMemo(() => buildLanguageOptions(t), [t]);
  const TURBO_SHIFT_OPTIONS = useMemo(() => buildTurboShiftOptions(t), [t]);
  const TRACK_NAME_OPTIONS = useMemo(() => buildTrackNameOptions(t), [t]);
  const BPM_OPTIONS_I18N = useMemo(
    () => BPM_OPTIONS.map((item) => ({ ...item, label: item.value ? item.label : t("music.option.unspecified") })),
    [t],
  );
  const KEYSCALE_OPTIONS_I18N = useMemo(
    () => KEYSCALE_OPTIONS.map((item) => ({ ...item, label: item.value ? item.label : t("music.option.unspecified") })),
    [t],
  );
  const TIMESIGNATURE_OPTIONS_I18N = useMemo(
    () => TIMESIGNATURE_OPTIONS.map((item) => ({ ...item, label: item.value ? item.label : t("music.option.unspecified") })),
    [t],
  );
  const assistSourceOptions = useMemo(
    () => ASSIST_SOURCE_OPTIONS.map((item) => ({
      ...item,
      label: item.value === "secondary_local"
        ? t("voice.recommendSource.secondary")
        : item.value === "primary_local"
          ? t("voice.recommendSource.primary")
          : item.label,
    })),
    [t],
  );
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentProjectFileHandle = useProjectStore((s) => s.currentProjectFileHandle);
  const bindCurrentProjectFile = useProjectStore((s) => s.bindCurrentProjectFile);
  const refreshCurrentProject = useProjectStore((s) => s.refreshCurrentProject);
  const script = useScriptStore((s) => s.script);
  const sourceText = useScriptStore((s) => s.sourceText);
  const pushToast = useUiStore((s) => s.pushToast);
  const setProjectSaveAction = useUiStore((s) => s.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((s) => s.clearProjectSaveAction);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [taskId, setTaskId] = useState("");
  const [taskStatus, setTaskStatus] = useState("idle");
  const [taskStage, setTaskStage] = useState("");
  const [taskError, setTaskError] = useState("");
  const [taskCancelMessage, setTaskCancelMessage] = useState("");
  const [cancelDetailOpen, setCancelDetailOpen] = useState(false);
  const [showConflictHint, setShowConflictHint] = useState(false);
  const [taskResult, setTaskResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetCategories, setAssetCategories] = useState([{ id: MUSIC_CATEGORY_UNCATEGORIZED, name: "__uncategorized__", builtin: true }]);
  const [assetCategoryFilter, setAssetCategoryFilter] = useState(MUSIC_CATEGORY_ALL);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [renamingCategoryId, setRenamingCategoryId] = useState("");
  const [renamingCategoryValue, setRenamingCategoryValue] = useState("");
  const [categoryBusyId, setCategoryBusyId] = useState("");
  const [activeCategoryActionId, setActiveCategoryActionId] = useState("");
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [previewAssetName, setPreviewAssetName] = useState("");
  const [previewAutoPlaySignal, setPreviewAutoPlaySignal] = useState(0);
  const [previewPauseSignal, setPreviewPauseSignal] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [attachingKey, setAttachingKey] = useState("");
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [isUploadingMusicAsset, setIsUploadingMusicAsset] = useState(false);
  const [assistSource, setAssistSource] = useState("secondary_local");
  const [assistStatus, setAssistStatus] = useState(null);
  const [assistInput, setAssistInput] = useState("");
  const [assistMessages, setAssistMessages] = useState([
    { role: "assistant", content: t("music.assist.welcome") },
  ]);
  const [isAssistLoading, setIsAssistLoading] = useState(false);
  const [isAssistUnloading, setIsAssistUnloading] = useState(false);
  const [isAssistChatting, setIsAssistChatting] = useState(false);
  const [isAssistFinalizing, setIsAssistFinalizing] = useState(false);
  const [deletingAssetName, setDeletingAssetName] = useState("");
  const [renamingAssetName, setRenamingAssetName] = useState("");
  const [renameAssetValue, setRenameAssetValue] = useState("");
  const [renamingBusyAssetName, setRenamingBusyAssetName] = useState("");
  const statusCardRef = useRef(null);
  const uploadInputRef = useRef(null);
  const autoRefreshedTaskIdRef = useRef("");

  const statusMeta = STATUS_META[taskStatus] || STATUS_META.idle;
  const musicEnabled = systemStatus?.config?.music_enabled !== false;
  const isMusicTaskActive = ACTIVE_STATUSES.has(taskStatus);
  const isAssistBusy = isAssistLoading || isAssistUnloading || isAssistChatting || isAssistFinalizing;
  const taskType = (form.task_type || "text2music").toLowerCase();
  const needsSourceAsset = ["cover", "repaint", "lego", "extract", "complete"].includes(taskType);
  const needsTrackName = ["extract", "lego"].includes(taskType);
  const needsRepaintRange = ["repaint", "lego"].includes(taskType);
  const needsReferenceAsset = taskType === "cover";
  const hideTextMusicInputs = taskType === "extract";
  const selectedModelVariant = String(validation?.model_variant || systemStatus?.config?.music_model_variant || "turbo").toLowerCase();
  const isTurboModel = selectedModelVariant === "turbo";
  const supportedTaskTypes = useMemo(
    () => (Array.isArray(validation?.supported_task_types) ? validation.supported_task_types : null),
    [validation],
  );
  const taskTypeOptions = useMemo(
    () => TASK_TYPE_OPTIONS.filter((item) => !supportedTaskTypes || supportedTaskTypes.includes(item.value)),
    [supportedTaskTypes],
  );
  const selectedTaskSupported = !supportedTaskTypes || supportedTaskTypes.includes(taskType);
  const shiftMin = 1.0;
  const shiftMax = isTurboModel ? 3.0 : 5.0;
  const wsUrl = taskId && ACTIVE_STATUSES.has(taskStatus)
    ? `${getWsBaseUrl()}/ws/music-progress/${taskId}`
    : "";

  const assetByName = useMemo(() => {
    const map = {};
    for (const item of assets) {
      if (item?.name) {
        map[item.name] = item;
      }
    }
    return map;
  }, [assets]);

  const categoryById = useMemo(() => {
    const map = {};
    for (const item of assetCategories) {
      if (item?.id) {
        map[item.id] = item;
      }
    }
    return map;
  }, [assetCategories]);
  const getCategoryName = useCallback(
    (name) => (name === "__uncategorized__" ? t("music.uncategorized") : name),
    [t],
  );

  const assetOptions = useMemo(
    () => [{ value: "", label: t("common.pleaseSelect") }, ...assets.map((item) => ({ value: item.name, label: item.name }))],
    [assets, t],
  );

  const categoryFilterOptions = useMemo(
    () => [
      { value: MUSIC_CATEGORY_ALL, label: t("common.all") },
      ...assetCategories.map((item) => ({ value: item.id, label: getCategoryName(item.name) })),
    ],
    [assetCategories, getCategoryName, t],
  );

  const assetCategoryOptions = useMemo(
    () => assetCategories.map((item) => ({ value: item.id, label: getCategoryName(item.name) })),
    [assetCategories, getCategoryName],
  );

  const filteredAssets = useMemo(() => {
    if (assetCategoryFilter === MUSIC_CATEGORY_ALL) {
      return assets;
    }
    return assets.filter((item) => (item?.category_id || MUSIC_CATEGORY_UNCATEGORIZED) === assetCategoryFilter);
  }, [assets, assetCategoryFilter]);

  const previewAudioUrl = previewAssetName
    ? `${API_ORIGIN}/api/v1/music/assets/${encodeURIComponent(previewAssetName)}/audio?v=${encodeURIComponent(assetByName[previewAssetName]?.updated_at || "")}`
    : "";

  function buildAssetAudioUrl(assetName) {
    if (!assetName) return "";
    return `${API_ORIGIN}/api/v1/music/assets/${encodeURIComponent(assetName)}/audio`;
  }

  const currentResultAssetName = inferAssetNameFromResult(taskResult);

  async function refreshSystemStatus() {
    try {
      const status = await api.get("/system/status");
      setSystemStatus(status || null);
    } catch {
      setSystemStatus(null);
    }
  }

  async function refreshAssistStatus() {
    try {
      const status = await api.get("/music/assist/status");
      setAssistStatus(status || null);
    } catch {
      setAssistStatus(null);
    }
  }

  async function refreshValidation() {
    setIsValidating(true);
    try {
      const report = await api.get("/music/model/validate");
      setValidation(report || null);
      return report || null;
    } catch (error) {
      setValidation({
        valid: false,
        exists: false,
        missing: [],
        message: getErrorMessage(error, t("music.toast.validateModelDirFailed")),
        
      });
      return null;
    } finally {
      setIsValidating(false);
    }
  }

  async function handleSelectModelVariant(value) {
    const nextVariant = String(value || "turbo").toLowerCase();
    if (!nextVariant || nextVariant === selectedModelVariant) {
      return;
    }
    setIsValidating(true);
    try {
      await api.post("/music/model/select", { model_variant: nextVariant });
      setForm((prev) => ({ ...prev, num_inference_steps: getDefaultInferenceSteps(nextVariant) }));
      const report = await api.get("/music/model/validate");
      setValidation(report || null);
      await refreshSystemStatus();
      pushToast({ title: t("music.toast.switchedModel", { model: nextVariant === "base" ? "Base" : "Turbo" }), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.switchModelFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsValidating(false);
    }
  }

  async function refreshAssets() {
    setIsLoadingAssets(true);
    try {
      const payload = await api.get("/music/assets");
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      const nextCategories = normalizeAssetCategories(payload?.categories);
      setAssets(nextItems);
      setAssetCategories(nextCategories);
      const validFilterIds = new Set([MUSIC_CATEGORY_ALL, ...nextCategories.map((item) => item.id)]);
      setAssetCategoryFilter((prev) => (validFilterIds.has(prev) ? prev : MUSIC_CATEGORY_ALL));
      if (!previewAssetName && nextItems.length > 0) {
        setPreviewAssetName(nextItems[0].name);
      }
    } catch (error) {
      pushToast({ title: t("music.toast.loadAssetsFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsLoadingAssets(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      pushToast({ title: t("music.toast.categoryNameRequired"), tone: "warning" });
      return;
    }
    setIsCreatingCategory(true);
    try {
      const result = await api.post("/music/assets/categories", { name });
      const nextCategories = normalizeAssetCategories(result?.categories);
      setAssetCategories(nextCategories);
      setNewCategoryName("");
      pushToast({ title: t("music.toast.categoryCreated"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.createCategoryFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsCreatingCategory(false);
    }
  }

  async function handleSetAssetCategory(assetName, categoryId) {
    if (!assetName) return;
    const normalizedCategoryId = String(categoryId || MUSIC_CATEGORY_UNCATEGORIZED);
    setCategoryBusyId(`${assetName}:set-category`);
    try {
      await api.post(`/music/assets/${encodeURIComponent(assetName)}/category`, { category_id: normalizedCategoryId });
      await refreshAssets();
    } catch (error) {
      pushToast({ title: t("music.toast.setCategoryFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setCategoryBusyId("");
    }
  }

  function handleStartRenameCategory(category) {
    if (!category?.id || category.builtin) {
      return;
    }
    setRenamingCategoryId(category.id);
    setRenamingCategoryValue(category.name || "");
    setActiveCategoryActionId(category.id);
  }

  function handleCancelRenameCategory() {
    setRenamingCategoryId("");
    setRenamingCategoryValue("");
  }

  async function handleConfirmRenameCategory(categoryId) {
    const name = renamingCategoryValue.trim();
    if (!categoryId || !name) {
      pushToast({ title: t("music.toast.categoryNameEmpty"), tone: "warning" });
      return;
    }
    setCategoryBusyId(`${categoryId}:rename`);
    try {
      const result = await api.post(`/music/assets/categories/${encodeURIComponent(categoryId)}/rename`, { name });
      setAssetCategories(normalizeAssetCategories(result?.categories));
      setRenamingCategoryId("");
      setRenamingCategoryValue("");
      setActiveCategoryActionId(categoryId);
      pushToast({ title: t("music.toast.categoryRenamed"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.renameCategoryFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setCategoryBusyId("");
    }
  }

  async function handleDeleteCategory(categoryId) {
    if (!categoryId || categoryId === MUSIC_CATEGORY_UNCATEGORIZED) {
      return;
    }
    const confirmed = window.confirm(t("music.confirm.deleteCategory"));
    if (!confirmed) return;
    setCategoryBusyId(`${categoryId}:delete`);
    try {
      const result = await api.delete(`/music/assets/categories/${encodeURIComponent(categoryId)}`);
      setAssetCategories(normalizeAssetCategories(result?.categories));
      if (assetCategoryFilter === categoryId) {
        setAssetCategoryFilter(MUSIC_CATEGORY_ALL);
      }
      if (activeCategoryActionId === categoryId) {
        setActiveCategoryActionId("");
      }
      await refreshAssets();
      pushToast({ title: t("music.toast.categoryDeleted"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.deleteCategoryFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setCategoryBusyId("");
    }
  }

  async function handleUploadMusicAsset(file) {
    if (!file) {
      return;
    }
    setIsUploadingMusicAsset(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploaded = await api.uploadForm("/music/assets/upload", formData);
      await refreshAssets();
      if (uploaded?.name) {
        setPreviewAssetName(uploaded.name);
        setForm((prev) => ({
          ...prev,
          source_asset_name: prev.source_asset_name || uploaded.name,
          reference_asset_name: taskType === "cover" && !prev.reference_asset_name ? uploaded.name : prev.reference_asset_name,
        }));
      }
      pushToast({ title: t("music.toast.assetUploaded"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.uploadAssetFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsUploadingMusicAsset(false);
    }
  }

  function validateGenerateForm() {
    if (!selectedTaskSupported) {
      return t("music.error.unsupportedTaskMode");
    }
    if (taskType !== "extract" && !form.prompt.trim()) {
      return t("music.error.enterPrompt");
    }
    if (needsSourceAsset && !form.source_asset_name) {
      return t("music.error.needSourceAsset");
    }
    if (needsReferenceAsset && !form.reference_asset_name) {
      return t("music.error.needReferenceAsset");
    }
    if (needsTrackName && !form.track_name.trim()) {
      return t("music.error.needTrackName");
    }
    if (
      selectedModelVariant === "base"
      && (Number(form.num_inference_steps || 0) < BASE_MIN_INFERENCE_STEPS
        || Number(form.num_inference_steps || 0) > BASE_MAX_INFERENCE_STEPS)
    ) {
      return t("music.error.baseInferenceRange");
    }
    {
      const shiftValue = Number(form.shift || 0);
      if (!Number.isFinite(shiftValue) || shiftValue < shiftMin || shiftValue > shiftMax) {
        return isTurboModel ? t("music.shiftHintTurbo") : t("music.shiftHintBase");
      }
      if (isTurboModel && !["1.0", "2.0", "3.0"].includes(String(shiftValue.toFixed(1)))) {
        return t("music.error.turboShiftFixed");
      }
    }
    if (needsRepaintRange) {
      const start = toNumberOrNull(form.repainting_start);
      const end = toNumberOrNull(form.repainting_end);
      if (start !== null && end !== null && end > 0 && start >= end) {
        return t("music.error.repaintingRange");
      }
    }
    return "";
  }

  useEffect(() => {
    refreshSystemStatus();
    refreshAssistStatus();
    refreshValidation();
    refreshAssets();
  }, []);

  useEffect(() => {
    if (!supportedTaskTypes || supportedTaskTypes.length === 0) {
      return;
    }
    if (supportedTaskTypes.includes(taskType)) {
      return;
    }
    setForm((prev) => ({ ...prev, task_type: supportedTaskTypes[0] || "text2music" }));
  }, [supportedTaskTypes, taskType]);

  useEffect(() => {
    if (selectedModelVariant !== "base") {
      return;
    }
    const current = Number(form.num_inference_steps || 0);
    if (current >= BASE_MIN_INFERENCE_STEPS && current <= BASE_MAX_INFERENCE_STEPS) {
      return;
    }
    setForm((prev) => ({ ...prev, num_inference_steps: getDefaultInferenceSteps("base") }));
  }, [selectedModelVariant, form.num_inference_steps]);

  useEffect(() => {
    if (!currentResultAssetName) {
      return;
    }
    setPreviewAssetName(currentResultAssetName);
  }, [currentResultAssetName]);

  useEffect(() => {
    if (taskStatus !== "done" || !taskId) {
      return;
    }
    if (autoRefreshedTaskIdRef.current === taskId) {
      return;
    }
    autoRefreshedTaskIdRef.current = taskId;
    void refreshAssets();
    const timer = window.setTimeout(() => {
      void refreshAssets();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [taskStatus, taskId]);

  useEffect(() => {
    let timer = null;
    async function tick() {
      await refreshSystemStatus();
      await refreshAssistStatus();
      timer = window.setTimeout(tick, 8000);
    }
    timer = window.setTimeout(tick, 8000);
    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useWebSocket(wsUrl, {
    enabled: Boolean(wsUrl),
    onMessage: (event) => {
      const msg = parseMusicEvent(event?.data);
      if (!msg) {
        return;
      }
      if (msg.type === "task_status") {
        setTaskStatus(msg.status || "running");
        return;
      }
      if (msg.type === "task_stage") {
        setTaskStage(msg.stage || "");
        return;
      }
      if (msg.type === "cancel_requested") {
        setTaskStatus("cancel_requested");
        setTaskCancelMessage(t("music.cancelInProgress"));
        return;
      }
      if (msg.type === "canceled") {
        setTaskStatus("canceled");
        setTaskStage("");
        setTaskCancelMessage(msg.message || t("music.toast.taskCanceled"));
        setCancelDetailOpen(false);
        setIsCancelling(false);
        return;
      }
      if (msg.type === "complete") {
        setTaskStatus("done");
        setTaskStage("");
        setTaskError("");
        setTaskCancelMessage("");
        setCancelDetailOpen(false);
        setShowConflictHint(false);
        setTaskResult(msg.data || null);
        setIsCancelling(false);
        refreshAssets();
        return;
      }
      if (msg.type === "error") {
        setTaskStatus("error");
        setTaskStage("");
        setTaskCancelMessage("");
        setCancelDetailOpen(false);
        setTaskError(msg.message || t("music.toast.generateFailed"));
        setIsCancelling(false);
      }
    },
  });

  useEffect(() => {
    if (!taskId || !ACTIVE_STATUSES.has(taskStatus)) {
      return;
    }
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) {
        return;
      }
      try {
        const state = await api.get(`/music/tasks/${taskId}`);
        if (!state) return;
        if (state.status === "done") {
          setTaskStatus("done");
          setTaskStage("");
          setTaskResult(state.result || null);
          setTaskError("");
          setTaskCancelMessage("");
          setCancelDetailOpen(false);
          setShowConflictHint(false);
          setIsCancelling(false);
          refreshAssets();
        } else if (state.status === "canceled") {
          setTaskStatus("canceled");
          setTaskStage("");
          setTaskCancelMessage(state.cancel_message || t("music.toast.taskCanceled"));
          setCancelDetailOpen(false);
          setIsCancelling(false);
        } else {
          setTaskStatus(state.status || "running");
          if (state.status === "cancel_requested") {
            setTaskCancelMessage(t("music.cancelInProgress"));
          }
        }
      } catch (error) {
        const message = getErrorMessage(error, t("music.toast.syncTaskStatusFailed"));
        setTaskStatus("error");
        setTaskStage("");
        setTaskCancelMessage("");
        setCancelDetailOpen(false);
        setTaskError(message);
        setIsCancelling(false);
      }
    }, 1800);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [taskId, taskStatus]);

  function buildAssistPayload(messages) {
    const sourceA = String(sourceText || "").trim();
    const sourceB = String(script?.source_text || "").trim();
    const sourceC = String(currentProject?.script?.source_text || "").trim();
    const contextText = sourceA || sourceB || sourceC || "";
    return {
      source: assistSource,
      messages,
      project_id: currentProject?.id || null,
      prompt: form.prompt || "",
      lyrics: form.lyrics || "",
      audio_duration: Number(form.audio_duration) || 30,
      vocal_language: form.vocal_language || "unknown",
      bpm: toNumberOrNull(form.bpm),
      keyscale: form.keyscale || null,
      timesignature: form.timesignature || null,
      context_text: contextText,
    };
  }

  function handleClearAssistConversation() {
    setAssistMessages([
      { role: "assistant", content: t("music.assist.chatCleared") },
    ]);
    setAssistInput("");
  }

  function downloadAudioUrl(audioUrl, fileName) {
    if (!audioUrl) return;
    const anchor = document.createElement("a");
    anchor.href = audioUrl;
    anchor.download = fileName || "music.wav";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  function focusStatusCard() {
    statusCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleAssistLoad() {
    setIsAssistLoading(true);
    try {
      await api.post("/music/assist/load", { source: assistSource });
      await refreshAssistStatus();
      pushToast({ title: t("music.toast.assistLoaded"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.loadAssistFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsAssistLoading(false);
    }
  }

  async function handleAssistUnload() {
    setIsAssistUnloading(true);
    try {
      await api.post("/music/assist/unload", {});
      await refreshAssistStatus();
      pushToast({ title: t("music.toast.assistUnloaded"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.unloadAssistFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsAssistUnloading(false);
    }
  }

  async function handleAssistSend() {
    const text = assistInput.trim();
    if (!text) {
      return;
    }
    const nextMessages = [...assistMessages, { role: "user", content: text }];
    setAssistMessages(nextMessages);
    setAssistInput("");
    setIsAssistChatting(true);
    try {
      const result = await api.post("/music/assist/chat", buildAssistPayload(nextMessages));
      const reply = String(result?.reply || "").trim() || t("music.assist.replyFallback");
      setAssistMessages([...nextMessages, { role: "assistant", content: reply }]);
      await refreshAssistStatus();
    } catch (error) {
      pushToast({ title: t("music.toast.assistChatFailed", { error: getErrorMessage(error) }), tone: "error" });
      setAssistMessages([...nextMessages, { role: "assistant", content: t("music.assist.chatFailed", { error: getErrorMessage(error) }) }]);
      await refreshAssistStatus();
    } finally {
      setIsAssistChatting(false);
    }
  }

  async function handleAssistFinalize() {
    if (assistMessages.length === 0) {
      pushToast({ title: t("music.toast.chatFirst"), tone: "warning" });
      return;
    }
    setIsAssistFinalizing(true);
    try {
      const result = await api.post("/music/assist/finalize", buildAssistPayload(assistMessages));
      setForm((prev) => ({
        ...prev,
        prompt: String(result?.prompt || prev.prompt || ""),
        lyrics: String(result?.lyrics || ""),
        audio_duration: Number(result?.audio_duration || prev.audio_duration || 30),
        vocal_language: normalizeSelectOptionValue(result?.vocal_language, LANGUAGE_OPTIONS, prev.vocal_language || "unknown"),
        bpm: normalizeNearestNumericOptionValue(result?.bpm, BPM_OPTIONS_I18N, ""),
        keyscale: normalizeSelectOptionValue(result?.keyscale, KEYSCALE_OPTIONS_I18N, ""),
        timesignature: normalizeSelectOptionValue(result?.timesignature, TIMESIGNATURE_OPTIONS_I18N, ""),
      }));
      const helperLines = [];
      if (result?.notes) {
        helperLines.push(String(result.notes));
      }
      if (Array.isArray(result?.warnings)) {
        for (const item of result.warnings) {
          if (String(item || "").trim()) {
            helperLines.push(t("music.assist.hint", { text: String(item).trim() }));
          }
        }
      }
      if (helperLines.length > 0) {
        setAssistMessages((prev) => [...prev, { role: "assistant", content: helperLines.join("\n") }]);
      }
      pushToast({ title: t("music.toast.formFilled"), tone: "success" });
      await refreshAssistStatus();
    } catch (error) {
      pushToast({ title: t("music.toast.finalizeFailed", { error: getErrorMessage(error) }), tone: "error" });
      await refreshAssistStatus();
    } finally {
      setIsAssistFinalizing(false);
    }
  }

  async function handleGenerate() {
    const validationError = validateGenerateForm();
    if (validationError) {
      pushToast({ title: validationError, tone: "warning" });
      return;
    }
    setIsSubmitting(true);
    setTaskError("");
    setTaskStage("");
    setTaskCancelMessage("");
    setCancelDetailOpen(false);
    setShowConflictHint(false);
    setTaskResult(null);
    try {
      const resolvedPrompt = taskType === "extract"
        ? (form.prompt.trim() || `extract ${form.track_name.trim() || "track"}`)
        : form.prompt.trim();
      const payload = {
        task_type: taskType,
        prompt: resolvedPrompt,
        project_id: currentProject?.id || null,
        lyrics: form.lyrics.trim(),
        audio_duration: Number(form.audio_duration),
        vocal_language: form.vocal_language.trim() || "unknown",
        num_inference_steps: Number(form.num_inference_steps),
        seed: toNumberOrNull(form.seed),
        source_asset_name: form.source_asset_name || null,
        reference_asset_name: form.reference_asset_name || null,
        bpm: toNumberOrNull(form.bpm),
        keyscale: form.keyscale.trim() || null,
        timesignature: form.timesignature.trim() || null,
        track_name: form.track_name.trim() || null,
        complete_track_classes: (form.complete_track_classes || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        repainting_start: toNumberOrNull(form.repainting_start),
        repainting_end: toNumberOrNull(form.repainting_end),
        audio_cover_strength: Number(form.audio_cover_strength || 1.0),
        guidance_scale: isTurboModel ? 0.0 : Number(form.guidance_scale || 7.0),
        shift: Number(form.shift || 3.0),
      };
      const created = await api.post("/music/generate", payload);
      setTaskId(created?.task_id || "");
      setTaskStatus("queued");
      pushToast({ title: t("music.toast.taskSubmitted"), tone: "success" });
      refreshSystemStatus();
      refreshAssistStatus();
    } catch (error) {
      if (error?.status === 409) {
        setTaskError(t("music.toast.taskAlreadyRunning"));
        setShowConflictHint(true);
        pushToast({ title: t("music.toast.taskAlreadyRunning"), tone: "warning" });
        return;
      }
      setTaskStatus("error");
      setTaskError(getErrorMessage(error, t("music.toast.submitTaskFailed")));
      pushToast({ title: t("music.toast.submitTaskFailedWithError", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!taskId || !ACTIVE_STATUSES.has(taskStatus)) {
      return;
    }
    setIsCancelling(true);
    try {
      const result = await api.post(`/music/tasks/${taskId}/cancel`, {});
      const nextStatus = result?.status || "cancel_requested";
      setTaskStatus(nextStatus);
      if (nextStatus === "cancel_requested") {
        setTaskCancelMessage(t("music.cancelInProgress"));
      }
      if (nextStatus === "canceled") {
        setTaskCancelMessage(t("music.toast.taskCanceled"));
        setIsCancelling(false);
      }
      pushToast({ title: nextStatus === "canceled" ? t("music.toast.taskCanceled") : t("music.toast.cancelRequested"), tone: "default" });
    } catch (error) {
      setIsCancelling(false);
      pushToast({ title: t("music.toast.cancelTaskFailed", { error: getErrorMessage(error) }), tone: "error" });
    }
  }

  async function handleAttach(assetName, target) {
    if (!currentProject?.id) {
      pushToast({ title: t("music.toast.selectProjectBeforeBind"), tone: "warning" });
      return;
    }
    const key = `${assetName}:${target}`;
    setAttachingKey(key);
    try {
      await api.post("/music/assets/attach", {
        project_id: currentProject.id,
        asset_name: assetName,
        target,
      });
      await refreshCurrentProject(currentProject.id);
      pushToast({
        title: target === "bgm" ? t("music.toast.boundBgm") : t("music.toast.boundAmbience"),
        tone: "success",
      });
    } catch (error) {
      pushToast({ title: t("music.toast.bindFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setAttachingKey("");
    }
  }

  async function handleDeleteAsset(assetName) {
    if (!assetName) {
      return;
    }
    const confirmed = window.confirm(t("music.confirm.deleteAsset", { name: assetName }));
    if (!confirmed) {
      return;
    }
    setDeletingAssetName(assetName);
    try {
      await api.delete(`/music/assets/${encodeURIComponent(assetName)}`);
      if (previewAssetName === assetName) {
        setPreviewAssetName("");
      }
      await refreshAssets();
      pushToast({ title: t("music.toast.assetDeleted"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.deleteAssetFailed", { error: getErrorMessage(error) }), tone: "error" });
    } finally {
      setDeletingAssetName("");
    }
  }

  function handleStartRenameAsset(assetName) {
    if (!assetName) {
      return;
    }
    setRenamingAssetName(assetName);
    setRenameAssetValue(assetName);
  }

  function handleCancelRenameAsset() {
    setRenamingAssetName("");
    setRenameAssetValue("");
    setRenamingBusyAssetName("");
  }

  async function handleConfirmRenameAsset(assetName) {
    if (!assetName) {
      return;
    }
    const newName = String(renameAssetValue || "").trim();
    if (!newName) {
      pushToast({ title: t("music.toast.newFileNameRequired"), tone: "warning" });
      return;
    }
    setRenamingBusyAssetName(assetName);
    try {
      const result = await api.post(`/music/assets/${encodeURIComponent(assetName)}/rename`, {
        new_name: newName,
      });
      const renamedName = String(result?.name || newName);
      setForm((prev) => ({
        ...prev,
        source_asset_name: prev.source_asset_name === assetName ? renamedName : prev.source_asset_name,
        reference_asset_name: prev.reference_asset_name === assetName ? renamedName : prev.reference_asset_name,
      }));
      if (previewAssetName === assetName) {
        setPreviewAssetName(renamedName);
      }
      handleCancelRenameAsset();
      await refreshAssets();
      pushToast({ title: t("music.toast.assetRenamed"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("music.toast.renameFailed", { error: getErrorMessage(error) }), tone: "error" });
      setRenamingBusyAssetName("");
    }
  }

  function playAssetPreview(assetName) {
    if (!assetName) return;
    setPreviewAssetName(assetName);
    setPreviewAutoPlaySignal((prev) => prev + 1);
  }

  function toggleAssetPreview(assetName) {
    if (!assetName) return;
    if (previewAssetName === assetName && isPreviewPlaying) {
      setPreviewPauseSignal((prev) => prev + 1);
      return;
    }
    setPreviewAssetName(assetName);
    setPreviewAutoPlaySignal((prev) => prev + 1);
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    if (!currentProject) {
      pushToast({ title: t("synth.toast.selectProjectFirst"), tone: "warning" });
      return;
    }
    const forceSaveAs = Boolean(options?.forceSaveAs);
    const effectiveScript =
      script && Array.isArray(script.segments) && script.segments.length
        ? script
        : currentProject.script || {
            title: "",
            source_text: "",
            segments: [],
            characters: [],
            metadata: {},
          };
    const payload = buildProjectFilePayload({
      project: currentProject,
      script: effectiveScript,
      sourceText: sourceText || effectiveScript.source_text || "",
    });

    setIsProjectSaving(true);
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
      pushToast({
        title: forceSaveAs ? t("text.toast.projectSavedAs") : result?.mode === "inplace" ? t("text.toast.projectSaved") : t("text.toast.projectExported"),
        tone: "success",
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        pushToast({ title: t("text.toast.saveProjectFailed", { error: getErrorMessage(error) }), tone: "error" });
      }
    } finally {
      setIsProjectSaving(false);
    }
  }, [
    currentProject,
    script,
    sourceText,
    currentProjectFileHandle,
    bindCurrentProjectFile,
    pushToast,
  ]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  return (
    <div className="pageGrid">
      <div className="pageGrid twoCols">
        <GlassCard>
          <h2 className="cardTitle">
            <Music size={16} /> {t("music.title")}
          </h2>
          <p className="cardSubtitle">
            {t("music.subtitle")}
          </p>

          {hideTextMusicInputs ? null : (
            <div className="musicAssistPanel">
            <div className="sectionHeader" style={{ marginBottom: 8 }}>
              <h3 className="cardTitle" style={{ fontSize: 14 }}>
                <Bot size={16} /> {t("music.assistTitle")}
              </h3>
              <div className="secondary">
                {assistStatus?.loaded ? t("music.assist.loaded", { source: assistStatus?.source || "-" }) : t("music.assist.unloaded")}
              </div>
            </div>
            <div className="editorGrid three" style={{ marginBottom: 8 }}>
              <div className="formGroup">
                <label className="formLabel">{t("music.assist.llmSource")}</label>
                <Select value={assistSource} onValueChange={setAssistSource} options={assistSourceOptions} />
              </div>
              <div className="formGroup">
                <label className="formLabel">{t("music.assist.status")}</label>
                <div className="secondary" style={{ paddingTop: 9 }}>
                  {assistStatus?.backend || "-"}
                </div>
              </div>
            </div>
            <div className="controlRow" style={{ marginBottom: 10 }}>
              <Button
                variant="secondary"
                disabled={isAssistBusy || isMusicTaskActive}
                onClick={handleAssistLoad}
              >
                {isAssistLoading ? <><LoaderCircle size={14} className="spin" /> {t("common.loading")}</> : t("music.assist.loadModel")}
              </Button>
              <Button
                variant="ghost"
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded}
                onClick={handleAssistUnload}
              >
                {isAssistUnloading ? <><LoaderCircle size={14} className="spin" /> {t("music.assist.unloading")}</> : t("music.assist.unloadModel")}
              </Button>
              <Button
                variant="primary"
                icon={Sparkles}
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || assistMessages.length === 0}
                onClick={handleAssistFinalize}
              >
                {isAssistFinalizing ? t("music.assist.filling") : t("music.assist.generateAndFill")}
              </Button>
              <Button
                variant="ghost"
                icon={Trash2}
                disabled={isAssistBusy || isMusicTaskActive}
                onClick={handleClearAssistConversation}
              >
                {t("music.assist.clearChat")}
              </Button>
            </div>
            <div className="musicAssistMessages">
              {assistMessages.map((item, index) => (
                <div key={`${item.role}-${index}`} className={`musicAssistMessage ${item.role}`}>
                  <div className="musicAssistRole">{item.role === "assistant" ? t("music.assist.roleAssistant") : t("music.assist.roleYou")}</div>
                  <div className="musicAssistContent">{item.content}</div>
                </div>
              ))}
            </div>
            <div className="musicAssistComposer">
              <textarea
                className="textArea compactArea"
                value={assistInput}
                onChange={(event) => setAssistInput(event.target.value)}
                placeholder={t("music.assist.inputPlaceholder")}
              />
              <Button
                variant="secondary"
                icon={SendHorizontal}
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || !assistInput.trim()}
                onClick={handleAssistSend}
              >
                {isAssistChatting ? t("music.assist.sending") : t("music.assist.send")}
              </Button>
            </div>
            {assistStatus?.error ? (
              <div className="errorText">{assistStatus.error}</div>
            ) : null}
            </div>
          )}

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">{t("music.field.model")}</label>
              <Select
                value={selectedModelVariant}
                onValueChange={handleSelectModelVariant}
                options={MUSIC_MODEL_VARIANT_OPTIONS}
                disabled={isValidating || isSubmitting || isMusicTaskActive}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("music.field.taskMode")}</label>
              <Select
                value={form.task_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, task_type: value }))}
                options={taskTypeOptions}
              />
              {!selectedTaskSupported ? (
                <div className="errorText" style={{ marginTop: 8 }}>
                  {t("music.error.unsupportedTaskMode")}
                </div>
              ) : null}
            </div>
            <div className="formGroup" style={{ gridColumn: "span 2" }}>
              <label className="formLabel">{t("music.field.audioInput")}</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  icon={Music}
                  disabled={isUploadingMusicAsset}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {isUploadingMusicAsset ? t("music.uploading") : t("music.uploadAudioToAssets")}
                </Button>
                <Button
                  variant="ghost"
                  icon={RefreshCw}
                  disabled={isUploadingMusicAsset}
                  onClick={refreshAssets}
                >
                  {t("music.refreshAssets")}
                </Button>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    handleUploadMusicAsset(file);
                  }
                }}
              />
            </div>
          </div>

          {needsSourceAsset ? (
            <div className="formGroup">
              <label className="formLabel">{t("music.field.sourceAsset")}</label>
              <Select
                value={form.source_asset_name}
                onValueChange={(value) => setForm((prev) => ({ ...prev, source_asset_name: value }))}
                options={assetOptions}
              />
            </div>
          ) : null}

          {needsReferenceAsset ? (
            <div className="formGroup">
              <label className="formLabel">{t("music.field.referenceAsset")}</label>
              <Select
                value={form.reference_asset_name}
                onValueChange={(value) => setForm((prev) => ({ ...prev, reference_asset_name: value }))}
                options={assetOptions}
              />
            </div>
          ) : null}

          {needsTrackName && taskType === "extract" ? (
            <div className="formGroup">
              <label className="formLabel">{t("music.field.trackType")}</label>
              <Select
                value={form.track_name}
                onValueChange={(value) => setForm((prev) => ({ ...prev, track_name: value }))}
                options={TRACK_NAME_OPTIONS}
              />
            </div>
          ) : null}

          {needsTrackName && taskType !== "extract" ? (
            <div className="editorGrid three">
              <div className="formGroup">
                <label className="formLabel">{t("music.field.trackType")}</label>
                <Select
                  value={form.track_name}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, track_name: value }))}
                  options={TRACK_NAME_OPTIONS}
                />
              </div>
              <div className="formGroup" style={{ gridColumn: "span 2" }}>
                <label className="formLabel">{t("music.field.trackNameEditable")}</label>
                <input
                  className="textInput"
                  value={form.track_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, track_name: event.target.value }))}
                  placeholder={t("music.placeholder.trackName")}
                />
              </div>
            </div>
          ) : null}

          {taskType === "complete" ? (
            <div className="formGroup">
              <label className="formLabel">{t("music.field.completeTrackClasses")}</label>
              <input
                className="textInput"
                value={form.complete_track_classes}
                onChange={(event) => setForm((prev) => ({ ...prev, complete_track_classes: event.target.value }))}
                placeholder={t("music.placeholder.completeTrackClasses")}
              />
            </div>
          ) : null}

          {needsRepaintRange ? (
            <div className="editorGrid two">
              <div className="formGroup">
                <label className="formLabel">{t("music.field.repaintingStart")}</label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.repainting_start}
                  onChange={(event) => setForm((prev) => ({ ...prev, repainting_start: event.target.value }))}
                  placeholder={t("music.placeholder.repaintingStart")}
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">{t("music.field.repaintingEnd")}</label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.repainting_end}
                  onChange={(event) => setForm((prev) => ({ ...prev, repainting_end: event.target.value }))}
                  placeholder={t("music.placeholder.repaintingEnd")}
                />
              </div>
            </div>
          ) : null}

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">Guidance Scale</label>
              <input
                className="textInput"
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={isTurboModel ? "0.0" : form.guidance_scale}
                onChange={(event) => setForm((prev) => ({ ...prev, guidance_scale: event.target.value }))}
                disabled={isTurboModel}
              />
              {isTurboModel ? (
                <div className="secondary" style={{ marginTop: 6 }}>{t("music.cfgDisabledForTurbo")}</div>
              ) : null}
            </div>
            <div className="formGroup">
              <label className="formLabel">Shift</label>
              {isTurboModel ? (
                <Select
                  value={TURBO_SHIFT_OPTIONS.some((item) => item.value === form.shift) ? form.shift : "3.0"}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, shift: value }))}
                  options={TURBO_SHIFT_OPTIONS}
                />
              ) : (
                <input
                  className="textInput"
                  type="number"
                  min={String(shiftMin)}
                  max={String(shiftMax)}
                  step="0.1"
                  value={form.shift}
                  onChange={(event) => setForm((prev) => ({ ...prev, shift: event.target.value }))}
                />
              )}
              <div className="secondary" style={{ marginTop: 6 }}>
                {isTurboModel ? t("music.shiftHintTurbo") : t("music.shiftHintBase")}
              </div>
            </div>
            {taskType === "extract" ? (
              <div className="formGroup">
                <label className="formLabel">{t("music.field.inferenceSteps")}</label>
                <input
                  className="textInput"
                  type="number"
                  min={selectedModelVariant === "base" ? String(BASE_MIN_INFERENCE_STEPS) : "1"}
                  max="100"
                  step="1"
                  value={form.num_inference_steps}
                  onChange={(event) => setForm((prev) => ({ ...prev, num_inference_steps: event.target.value }))}
                />
              </div>
            ) : (
              <div className="formGroup">
                <label className="formLabel">{t("music.field.coverStrength")}</label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.audio_cover_strength}
                  onChange={(event) => setForm((prev) => ({ ...prev, audio_cover_strength: event.target.value }))}
                  disabled={taskType !== "cover"}
                />
              </div>
            )}
          </div>

          {hideTextMusicInputs ? null : (
            <>
              <div className="formGroup">
                <label className="formLabel">{t("music.field.promptRequired")}</label>
                <textarea
                  className="textArea"
                  value={form.prompt}
                  onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))}
                  placeholder={t("music.placeholder.prompt")}
                  style={{ minHeight: 108 }}
                />
              </div>

              <div className="formGroup">
                <label className="formLabel">{t("music.field.lyricsOptional")}</label>
                <textarea
                  className="textArea compactArea"
                  value={form.lyrics}
                  onChange={(event) => setForm((prev) => ({ ...prev, lyrics: event.target.value }))}
                  placeholder={t("music.placeholder.lyrics")}
                />
              </div>

              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.durationSec")}</label>
                  <input
                    className="textInput"
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    value={form.audio_duration}
                    onChange={(event) => setForm((prev) => ({ ...prev, audio_duration: event.target.value }))}
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.inferenceSteps")}</label>
                  <input
                    className="textInput"
                    type="number"
                    min={selectedModelVariant === "base" ? String(BASE_MIN_INFERENCE_STEPS) : "1"}
                    max="100"
                    step="1"
                    value={form.num_inference_steps}
                    onChange={(event) => setForm((prev) => ({ ...prev, num_inference_steps: event.target.value }))}
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.language")}</label>
                  <Select
                    value={form.vocal_language}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, vocal_language: value }))}
                    options={LANGUAGE_OPTIONS}
                  />
                </div>
              </div>

              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.seedOptional")}</label>
                  <input
                    className="textInput"
                    type="number"
                    step="1"
                    value={form.seed}
                    onChange={(event) => setForm((prev) => ({ ...prev, seed: event.target.value }))}
                    placeholder={t("music.placeholder.seed")}
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.bpmOptional")}</label>
                  <Select
                    value={form.bpm}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, bpm: value }))}
                    options={BPM_OPTIONS_I18N}
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("music.field.keyscaleOptional")}</label>
                  <Select
                    value={form.keyscale}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, keyscale: value }))}
                    options={KEYSCALE_OPTIONS_I18N}
                  />
                </div>
              </div>

              <div className="formGroup">
                <label className="formLabel">{t("music.field.timesignatureOptional")}</label>
                <Select
                  value={form.timesignature}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, timesignature: value }))}
                  options={TIMESIGNATURE_OPTIONS_I18N}
                />
              </div>
            </>
          )}

          {hideTextMusicInputs ? (
            <div className="controlRow">
              <Button
                variant="primary"
                disabled={isSubmitting || !musicEnabled || ACTIVE_STATUSES.has(taskStatus) || !selectedTaskSupported}
                onClick={handleGenerate}
              >
                {isSubmitting ? t("music.generating") : t("music.startGenerate")}
              </Button>
            </div>
          ) : (
            <div className="controlRow">
              <Button
                variant="primary"
                disabled={isSubmitting || !musicEnabled || ACTIVE_STATUSES.has(taskStatus) || !selectedTaskSupported}
                onClick={handleGenerate}
              >
                {isSubmitting ? t("music.generating") : t("music.startGenerate")}
              </Button>
              <Button
                variant="secondary"
                disabled={!taskId || !ACTIVE_STATUSES.has(taskStatus) || isCancelling}
                onClick={handleCancel}
              >
                {isCancelling ? t("music.cancelling") : t("music.cancelTask")}
              </Button>
              <Button variant="ghost" icon={RefreshCw} onClick={refreshAssets}>
                {t("music.refreshAssets")}
              </Button>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <div className="sectionHeader">
            <h2 className="cardTitle">{t("music.runtime")}</h2>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refreshValidation} disabled={isValidating}>
              {t("music.validateModelDir")}
            </Button>
          </div>

          <div className="listStack">
            <div className="statRow">
              <span>{t("music.runtime.taskStatus")}</span>
              <StatusBadge label={t(statusMeta.label)} tone={statusMeta.tone} />
            </div>
            <div className="statRow">
              <span>{t("music.runtime.enabled")}</span>
              <strong style={{ color: musicEnabled ? "var(--success)" : "var(--warning)" }}>
                {musicEnabled ? t("common.yes") : t("common.no")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.taskId")}</span>
              <strong style={{ fontFamily: "monospace", fontSize: 11.5 }}>
                {taskId || "-"}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.stage")}</span>
              <strong>{taskStage || "-"}</strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.currentProject")}</span>
              <strong>{currentProject?.name || t("project.unselected")}</strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.modelDir")}</span>
              <strong title={validation?.model_dir || ""} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {validation?.model_dir || t("music.runtime.unconfigured")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.modelValidation")}</span>
              <strong style={{ color: validation?.valid ? "var(--success)" : "var(--warning)" }}>
                {validation?.valid ? t("music.runtime.pass") : t("music.runtime.fail")}
              </strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.modelType")}</span>
              <strong>{validation ? (validation.is_turbo ? "Turbo" : "Base / SFT") : "-"}</strong>
            </div>
            <div className="statRow">
              <span>{t("music.runtime.supportedTasks")}</span>
              <strong style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {Array.isArray(validation?.supported_task_types) && validation.supported_task_types.length
                  ? validation.supported_task_types.join(", ")
                  : "-"}
              </strong>
            </div>
            {validation?.message ? (
              <div className={validation?.valid ? "secondary" : "errorText"}>{validation.message}</div>
            ) : null}
            {Array.isArray(validation?.missing) && validation.missing.length ? (
              <div className="codeBlock">{validation.missing.join("\n")}</div>
            ) : null}
            {taskError ? (
              <div className="errorText">{taskError}</div>
            ) : null}
            {showConflictHint && taskId ? (
              <div className="controlRow">
                <Button variant="ghost" size="sm" onClick={focusStatusCard}>
                  {t("music.runtime.locateTask")}
                </Button>
              </div>
            ) : null}
            {taskStatus === "canceled" && taskCancelMessage ? (
              <div className="listStack" style={{ marginTop: 8, gap: 6 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={cancelDetailOpen ? ChevronUp : ChevronDown}
                  onClick={() => setCancelDetailOpen((prev) => !prev)}
                >
                  {t("music.runtime.cancelDetail")}
                </Button>
                {cancelDetailOpen ? (
                  <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
                    {taskCancelMessage}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {previewAudioUrl ? (
            <div className="listStack">
              <div className="formLabel">{t("music.preview")}</div>
              <AudioPlayer
                audioUrl={previewAudioUrl}
                compact
                autoPlaySignal={previewAutoPlaySignal}
                pauseSignal={previewPauseSignal}
                onPlayStateChange={setIsPreviewPlaying}
              />
              {currentResultAssetName ? (
                <div className="controlRow">
                  <Button
                    variant="ghost"
                    icon={Download}
                    onClick={() => downloadAudioUrl(buildAssetAudioUrl(currentResultAssetName), currentResultAssetName)}
                  >
                    {t("music.downloadCurrent")}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Save}
                    disabled={attachingKey === `${currentResultAssetName}:bgm`}
                    onClick={() => handleAttach(currentResultAssetName, "bgm")}
                  >
                    {t("music.bindAsBgm")}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Save}
                    disabled={attachingKey === `${currentResultAssetName}:ambience`}
                    onClick={() => handleAttach(currentResultAssetName, "ambience")}
                  >
                    {t("music.bindAsAmbience")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onNavigate?.("synth")}
                  >
                    {t("music.goSynthesis")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="emptyState">{t("music.empty.noPreviewableAssets")}</div>
          )}
        </GlassCard>
      </div>

        <GlassCard>
          <div ref={statusCardRef} />
          <div className="sectionHeader">
          <h2 className="cardTitle">{t("music.assets")}</h2>
          <div className="secondary">
            {isLoadingAssets ? t("common.refreshing") : t("music.assetsCount", { shown: filteredAssets.length, total: assets.length })}
          </div>
        </div>
        <div className="musicAssetCategoryToolbar">
          <div style={{ minWidth: 200 }}>
            <Select
              value={assetCategoryFilter}
              onValueChange={setAssetCategoryFilter}
              options={categoryFilterOptions}
            />
          </div>
          <input
            className="textInput"
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder={t("music.newCategoryName")}
            style={{ maxWidth: 220 }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={isCreatingCategory}
            onClick={handleCreateCategory}
          >
            {isCreatingCategory ? t("music.creating") : t("music.newCategory")}
          </Button>
        </div>
        {assetCategories.filter((item) => !item.builtin).length > 0 ? (
          <div className="musicCategoryList">
            {assetCategories.filter((item) => !item.builtin).map((category) => (
              <div key={category.id} className="musicCategoryRowCompact">
                {renamingCategoryId === category.id ? (
                  <>
                    <input
                      className="textInput"
                      value={renamingCategoryValue}
                      onChange={(event) => setRenamingCategoryValue(event.target.value)}
                      style={{ maxWidth: 220 }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={categoryBusyId === `${category.id}:rename`}
                      onClick={() => handleConfirmRenameCategory(category.id)}
                    >
                      {categoryBusyId === `${category.id}:rename` ? t("common.saving") : t("common.save")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={categoryBusyId === `${category.id}:rename`}
                      onClick={handleCancelRenameCategory}
                    >
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`musicCategoryChip ${activeCategoryActionId === category.id ? "active" : ""}`}
                      onClick={() => setActiveCategoryActionId((prev) => (prev === category.id ? "" : category.id))}
                    >
                      {category.name}
                    </button>
                    {activeCategoryActionId === category.id ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          disabled={Boolean(categoryBusyId)}
                          onClick={() => handleStartRenameCategory(category)}
                        >
                          {t("common.rename")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          disabled={categoryBusyId === `${category.id}:delete`}
                          onClick={() => handleDeleteCategory(category.id)}
                        >
                          {categoryBusyId === `${category.id}:delete` ? t("common.deleting") : t("common.delete")}
                        </Button>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {assets.length === 0 ? (
          <div className="emptyState">
            <span>{t("music.empty.noResults")}</span>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="emptyState">
            <span>{t("music.empty.noAssetsInCategory")}</span>
          </div>
        ) : (
          <div className="musicAssetList">
            {filteredAssets.map((item) => (
              <div key={item.name} className={`musicAssetRow ${previewAssetName === item.name ? "active" : ""}`}>
                {renamingAssetName === item.name ? (
                  <div className="musicAssetMeta" style={{ cursor: "default" }}>
                    <input
                      className="textInput"
                      value={renameAssetValue}
                      onChange={(event) => setRenameAssetValue(event.target.value)}
                      style={{ maxWidth: 320 }}
                    />
                    <div className="musicAssetSub">
                      <span>{formatFileSize(item.size)}</span>
                      <span>{formatDateTime(item.updated_at)}</span>
                    </div>
                  </div>
                ) : (
                  <button
                    className="musicAssetMeta"
                    onClick={() => setPreviewAssetName(item.name)}
                    type="button"
                  >
                    <div className="musicAssetName">{item.name}</div>
                    <div className="musicAssetCategoryTag">{item.category_name || categoryById[item.category_id]?.name || t("music.uncategorized")}</div>
                    <div className="musicAssetSub">
                      <span>{formatFileSize(item.size)}</span>
                      <span>{formatDateTime(item.updated_at)}</span>
                    </div>
                  </button>
                )}
                <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                  {renamingAssetName === item.name ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={renamingBusyAssetName === item.name}
                        onClick={() => handleConfirmRenameAsset(item.name)}
                      >
                        {renamingBusyAssetName === item.name ? t("common.saving") : t("common.save")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={renamingBusyAssetName === item.name}
                        onClick={handleCancelRenameAsset}
                      >
                        {t("common.cancel")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div style={{ minWidth: 150 }}>
                        <Select
                          value={item.category_id || MUSIC_CATEGORY_UNCATEGORIZED}
                          onValueChange={(value) => handleSetAssetCategory(item.name, value)}
                          options={assetCategoryOptions}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        disabled={deletingAssetName === item.name || Boolean(categoryBusyId)}
                        onClick={() => handleStartRenameAsset(item.name)}
                      >
                        {t("common.rename")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={previewAssetName === item.name && isPreviewPlaying ? Pause : Play}
                        onClick={() => toggleAssetPreview(item.name)}
                      >
                        {previewAssetName === item.name && isPreviewPlaying ? t("common.pause") : t("common.play")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Download}
                        onClick={() => downloadAudioUrl(buildAssetAudioUrl(item.name), item.name)}
                      >
                        {t("common.download")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        disabled={deletingAssetName === item.name || Boolean(categoryBusyId)}
                        onClick={() => handleDeleteAsset(item.name)}
                      >
                        {deletingAssetName === item.name ? t("common.deleting") : t("common.delete")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={attachingKey === `${item.name}:bgm`}
                        onClick={() => handleAttach(item.name, "bgm")}
                      >
                        {t("music.setAsBgm")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={attachingKey === `${item.name}:ambience`}
                        onClick={() => handleAttach(item.name, "ambience")}
                      >
                        {t("music.setAsAmbience")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
