import { ChevronDown, ChevronUp, Download, Music, Pause, Pencil, Play, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MusicAssistPanel from "../components/music/MusicAssistPanel";
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
import {
  ACTIVE_MUSIC_STATUSES,
  BASE_MAX_INFERENCE_STEPS,
  BASE_MIN_INFERENCE_STEPS,
  BPM_OPTIONS,
  DEFAULT_MUSIC_FORM,
  KEYSCALE_OPTIONS,
  LANGUAGE_OPTIONS,
  MUSIC_CATEGORY_ALL,
  MUSIC_CATEGORY_UNCATEGORIZED,
  MUSIC_MODEL_VARIANT_OPTIONS,
  MUSIC_STATUS_META,
  TASK_TYPE_OPTIONS,
  TIMESIGNATURE_OPTIONS,
  TRACK_NAME_OPTIONS,
  TURBO_SHIFT_OPTIONS,
  formatDateTime,
  formatFileSize,
  getDefaultInferenceSteps,
  inferAssetNameFromResult,
  normalizeAssetCategories,
  normalizeNearestNumericOptionValue,
  normalizeSelectOptionValue,
  parseMusicEvent,
  toNumberOrNull,
} from "../utils/musicPageData";

export default function MusicPage({ onNavigate }) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentProjectFileHandle = useProjectStore((s) => s.currentProjectFileHandle);
  const bindCurrentProjectFile = useProjectStore((s) => s.bindCurrentProjectFile);
  const refreshCurrentProject = useProjectStore((s) => s.refreshCurrentProject);
  const script = useScriptStore((s) => s.script);
  const sourceText = useScriptStore((s) => s.sourceText);
  const pushToast = useUiStore((s) => s.pushToast);
  const setProjectSaveAction = useUiStore((s) => s.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((s) => s.clearProjectSaveAction);

  const [form, setForm] = useState(DEFAULT_MUSIC_FORM);
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
  const [assetCategories, setAssetCategories] = useState([{ id: MUSIC_CATEGORY_UNCATEGORIZED, name: "未分类", builtin: true }]);
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
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(true);
  const [isMusicAssistOpen, setIsMusicAssistOpen] = useState(false);
  const [isAdvancedMusicOpen, setIsAdvancedMusicOpen] = useState(false);
  const [isStatusDetailOpen, setIsStatusDetailOpen] = useState(false);
  const [assistSource, setAssistSource] = useState("secondary_local");
  const [assistStatus, setAssistStatus] = useState(null);
  const [assistInput, setAssistInput] = useState("");
  const [assistMessages, setAssistMessages] = useState([
    { role: "assistant", content: "告诉我你想要的音乐风格、情绪和用途，或根据项目文本生成音乐，我们先对齐方向。你也可以直接输入：根据项目文本生成音乐。" },
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
  const lastAppliedModelVariantRef = useRef("");

  const statusMeta = MUSIC_STATUS_META[taskStatus] || MUSIC_STATUS_META.idle;
  const musicEnabled = systemStatus?.config?.music_enabled !== false;
  const isMusicTaskActive = ACTIVE_MUSIC_STATUSES.has(taskStatus);
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
  const displayBpmValue = normalizeNearestNumericOptionValue(form.bpm, BPM_OPTIONS, "");
  const shiftMin = 1.0;
  const shiftMax = isTurboModel ? 3.0 : 5.0;
  const wsUrl = taskId && ACTIVE_MUSIC_STATUSES.has(taskStatus)
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

  const assetOptions = useMemo(
    () => [{ value: "", label: "请选择" }, ...assets.map((item) => ({ value: item.name, label: item.name }))],
    [assets],
  );

  const categoryFilterOptions = useMemo(
    () => [
      { value: MUSIC_CATEGORY_ALL, label: "全部" },
      ...assetCategories.map((item) => ({ value: item.id, label: item.name })),
    ],
    [assetCategories],
  );

  const assetCategoryOptions = useMemo(
    () => assetCategories.map((item) => ({ value: item.id, label: item.name })),
    [assetCategories],
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
        message: getErrorMessage(error, "模型目录校验失败"),
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
      pushToast({ title: `已切换到 ${nextVariant === "base" ? "Base" : "Turbo"} 模型`, tone: "success" });
    } catch (error) {
      pushToast({ title: `切换模型失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: `加载音乐资产失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setIsLoadingAssets(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      pushToast({ title: "请输入分类名称", tone: "warning" });
      return;
    }
    setIsCreatingCategory(true);
    try {
      const result = await api.post("/music/assets/categories", { name });
      const nextCategories = normalizeAssetCategories(result?.categories);
      setAssetCategories(nextCategories);
      setNewCategoryName("");
      pushToast({ title: "分类已创建", tone: "success" });
    } catch (error) {
      pushToast({ title: `创建分类失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: `设置分类失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: "分类名称不能为空", tone: "warning" });
      return;
    }
    setCategoryBusyId(`${categoryId}:rename`);
    try {
      const result = await api.post(`/music/assets/categories/${encodeURIComponent(categoryId)}/rename`, { name });
      setAssetCategories(normalizeAssetCategories(result?.categories));
      setRenamingCategoryId("");
      setRenamingCategoryValue("");
      setActiveCategoryActionId(categoryId);
      pushToast({ title: "分类已重命名", tone: "success" });
    } catch (error) {
      pushToast({ title: `重命名分类失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setCategoryBusyId("");
    }
  }

  async function handleDeleteCategory(categoryId) {
    if (!categoryId || categoryId === MUSIC_CATEGORY_UNCATEGORIZED) {
      return;
    }
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除分类",
      description: "删除分类后，分类下资产将回到未分类，是否继续？",
      confirmLabel: "删除",
      danger: true,
    });
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
      pushToast({ title: "分类已删除", tone: "success" });
    } catch (error) {
      pushToast({ title: `删除分类失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: "音乐资产上传成功", tone: "success" });
    } catch (error) {
      pushToast({ title: `上传资产失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setIsUploadingMusicAsset(false);
    }
  }

  function validateGenerateForm() {
    if (!selectedTaskSupported) {
      return "当前任务模式不受所选模型支持，请切换模型或任务模式";
    }
    if (taskType !== "extract" && !form.prompt.trim()) {
      return "请输入音乐描述";
    }
    if (needsSourceAsset && !form.source_asset_name) {
      return "当前模式需要选择源音频";
    }
    if (needsReferenceAsset && !form.reference_asset_name) {
      return "当前模式需要选择参考音频";
    }
    if (needsTrackName && !form.track_name.trim()) {
      return "当前模式需要填写轨道名称";
    }
    if (
      selectedModelVariant === "base"
      && (Number(form.num_inference_steps || 0) < BASE_MIN_INFERENCE_STEPS
        || Number(form.num_inference_steps || 0) > BASE_MAX_INFERENCE_STEPS)
    ) {
      return "Base 模型推理步数需要 32 - 100";
    }
    {
      const shiftValue = Number(form.shift || 0);
      if (!Number.isFinite(shiftValue) || shiftValue < shiftMin || shiftValue > shiftMax) {
        return isTurboModel ? "Turbo 模型建议 shift 在 1.0 - 3.0" : "Base 模型建议 shift 在 1.0 - 5.0";
      }
      if (isTurboModel && !["1.0", "2.0", "3.0"].includes(String(shiftValue.toFixed(1)))) {
        return "Turbo 模型只支持 shift 1.0 / 2.0 / 3.0";
      }
    }
    if (needsRepaintRange) {
      const start = toNumberOrNull(form.repainting_start);
      const end = toNumberOrNull(form.repainting_end);
      if (start !== null && end !== null && end > 0 && start >= end) {
        return "重绘起点必须小于终点";
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
    const variant = selectedModelVariant === "base" ? "base" : "turbo";
    if (lastAppliedModelVariantRef.current === variant) {
      return;
    }
    lastAppliedModelVariantRef.current = variant;
    setForm((prev) => {
      const nextSteps = getDefaultInferenceSteps(variant);
      if (String(prev.num_inference_steps) === String(nextSteps)) {
        return prev;
      }
      return { ...prev, num_inference_steps: nextSteps };
    });
  }, [selectedModelVariant]);

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
        setTaskCancelMessage("正在取消任务，当前生成阶段结束后会停止。");
        return;
      }
      if (msg.type === "canceled") {
        setTaskStatus("canceled");
        setTaskStage("");
        setTaskCancelMessage(msg.message || "任务已取消");
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
        setTaskError(msg.message || "音乐生成失败");
        setIsCancelling(false);
      }
    },
  });

  useEffect(() => {
    if (!taskId || !ACTIVE_MUSIC_STATUSES.has(taskStatus)) {
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
          setTaskCancelMessage(state.cancel_message || "任务已取消");
          setCancelDetailOpen(false);
          setIsCancelling(false);
        } else {
          setTaskStatus(state.status || "running");
          if (state.status === "cancel_requested") {
            setTaskCancelMessage("正在取消任务，当前生成阶段结束后会停止。");
          }
        }
      } catch (error) {
        const message = getErrorMessage(error, "任务状态同步失败");
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
      { role: "assistant", content: "对话已清空。告诉我新的音乐方向。你也可以直接输入：根据项目文本生成音乐。" },
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
      pushToast({ title: "音乐助手模型已加载", tone: "success" });
    } catch (error) {
      pushToast({ title: `加载音乐助手失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setIsAssistLoading(false);
    }
  }

  async function handleAssistUnload() {
    setIsAssistUnloading(true);
    try {
      await api.post("/music/assist/unload", {});
      await refreshAssistStatus();
      pushToast({ title: "音乐助手模型已卸载", tone: "success" });
    } catch (error) {
      pushToast({ title: `卸载音乐助手失败：${getErrorMessage(error)}`, tone: "error" });
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
      const reply = String(result?.reply || "").trim() || "我记录下来了，我们可以继续细化。";
      setAssistMessages([...nextMessages, { role: "assistant", content: reply }]);
      await refreshAssistStatus();
    } catch (error) {
      pushToast({ title: `音乐助手对话失败：${getErrorMessage(error)}`, tone: "error" });
      setAssistMessages([...nextMessages, { role: "assistant", content: `对话失败：${getErrorMessage(error)}` }]);
      await refreshAssistStatus();
    } finally {
      setIsAssistChatting(false);
    }
  }

  async function handleAssistFinalize() {
    if (assistMessages.length === 0) {
      pushToast({ title: "请先和音乐助手对话后再生成填入", tone: "warning" });
      return;
    }
    setIsAssistFinalizing(true);
    try {
      const result = await api.post("/music/assist/finalize", buildAssistPayload(assistMessages));
      const resultBpm = toNumberOrNull(result?.bpm);
      setForm((prev) => ({
        ...prev,
        prompt: String(result?.prompt || prev.prompt || ""),
        lyrics: String(result?.lyrics || ""),
        audio_duration: Number(result?.audio_duration || prev.audio_duration || 30),
        vocal_language: normalizeSelectOptionValue(result?.vocal_language, LANGUAGE_OPTIONS, prev.vocal_language || "unknown"),
        bpm: resultBpm === null ? "" : String(resultBpm),
        keyscale: normalizeSelectOptionValue(result?.keyscale, KEYSCALE_OPTIONS, ""),
        timesignature: normalizeSelectOptionValue(result?.timesignature, TIMESIGNATURE_OPTIONS, ""),
      }));
      const helperLines = [];
      if (result?.notes) {
        helperLines.push(String(result.notes));
      }
      if (Array.isArray(result?.warnings)) {
        for (const item of result.warnings) {
          if (String(item || "").trim()) {
            helperLines.push(`提示：${String(item).trim()}`);
          }
        }
      }
      if (helperLines.length > 0) {
        setAssistMessages((prev) => [...prev, { role: "assistant", content: helperLines.join("\n") }]);
      }
      pushToast({ title: "已生成并填入音乐表单", tone: "success" });
      await refreshAssistStatus();
    } catch (error) {
      pushToast({ title: `生成并填入失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: "音乐生成任务已提交", tone: "success" });
      refreshSystemStatus();
      refreshAssistStatus();
    } catch (error) {
      if (error?.status === 409) {
        setTaskError("已有音乐任务正在进行，请等待当前任务结束后再提交。");
        setShowConflictHint(true);
        pushToast({ title: "已有任务正在执行，请稍后再试", tone: "warning" });
        return;
      }
      setTaskStatus("error");
      setTaskError(getErrorMessage(error, "音乐生成任务提交失败"));
      pushToast({ title: `任务提交失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!taskId || !ACTIVE_MUSIC_STATUSES.has(taskStatus)) {
      return;
    }
    setIsCancelling(true);
    try {
      const result = await api.post(`/music/tasks/${taskId}/cancel`, {});
      const nextStatus = result?.status || "cancel_requested";
      setTaskStatus(nextStatus);
      if (nextStatus === "cancel_requested") {
        setTaskCancelMessage("正在取消任务，当前生成阶段结束后会停止。");
      }
      if (nextStatus === "canceled") {
        setTaskCancelMessage("任务已取消");
        setIsCancelling(false);
      }
      pushToast({ title: nextStatus === "canceled" ? "任务已取消" : "已请求取消任务", tone: "default" });
    } catch (error) {
      setIsCancelling(false);
      pushToast({ title: `取消任务失败：${getErrorMessage(error)}`, tone: "error" });
    }
  }

  async function handleAttach(assetName, target) {
    if (!currentProject?.id) {
      pushToast({ title: "请先选择项目后再绑定音乐", tone: "warning" });
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
        title: target === "bgm" ? "已绑定到背景音乐" : "已绑定到环境音",
        tone: "success",
      });
    } catch (error) {
      pushToast({ title: `绑定失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setAttachingKey("");
    }
  }

  async function handleDeleteAsset(assetName) {
    if (!assetName) {
      return;
    }
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除音乐资产",
      description: `确认删除音乐资产「${assetName}」吗？`,
      confirmLabel: "删除",
      danger: true,
    });
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
      pushToast({ title: "音乐资产已删除", tone: "success" });
    } catch (error) {
      pushToast({ title: `删除资产失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: "请输入新的文件名", tone: "warning" });
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
      pushToast({ title: "音乐资产已重命名", tone: "success" });
    } catch (error) {
      pushToast({ title: `重命名失败：${getErrorMessage(error)}`, tone: "error" });
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
      pushToast({ title: "请先创建或选择项目", tone: "warning" });
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
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        pushToast({ title: `保存项目失败：${getErrorMessage(error)}`, tone: "error" });
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
      <div className="pageGrid musicGenerationStack">
        <GlassCard>
          <h2 className="cardTitle">
            <Music size={16} /> 音乐生成
          </h2>
          <p className="cardSubtitle">
            使用已配置的 ACE-Step Diffusers 本地模型生成音乐，不自动下载模型。
          </p>

          {hideTextMusicInputs ? null : (
            <div className="musicCollapsibleBlock">
              <div className="musicInlineHeader">
                <div>
                  <div className="musicInlineTitle">音乐助手</div>
                  <div className="musicInlineMeta">{assistStatus?.loaded ? `已加载 ${assistStatus.source || ""}` : "按需展开"}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={isMusicAssistOpen ? ChevronUp : ChevronDown}
                  aria-expanded={isMusicAssistOpen}
                  onClick={() => setIsMusicAssistOpen((prev) => !prev)}
                >
                  {isMusicAssistOpen ? "收起" : "展开"}
                </Button>
              </div>
              {isMusicAssistOpen ? (
                <MusicAssistPanel
                  assistInput={assistInput}
                  assistMessages={assistMessages}
                  assistSource={assistSource}
                  assistStatus={assistStatus}
                  isAssistBusy={isAssistBusy}
                  isAssistChatting={isAssistChatting}
                  isAssistFinalizing={isAssistFinalizing}
                  isAssistLoading={isAssistLoading}
                  isAssistUnloading={isAssistUnloading}
                  isMusicTaskActive={isMusicTaskActive}
                  onAssistFinalize={handleAssistFinalize}
                  onAssistLoad={handleAssistLoad}
                  onAssistSend={handleAssistSend}
                  onAssistUnload={handleAssistUnload}
                  onClearAssistConversation={handleClearAssistConversation}
                  onInputChange={setAssistInput}
                  onSourceChange={setAssistSource}
                />
              ) : null}
            </div>
          )}

          <div className="editorGrid three">
            <div className="formGroup">
              <label className="formLabel">Music 模型</label>
              <Select
                value={selectedModelVariant}
                onValueChange={handleSelectModelVariant}
                options={MUSIC_MODEL_VARIANT_OPTIONS}
                disabled={isValidating || isSubmitting || isMusicTaskActive}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">任务模式</label>
              <Select
                value={form.task_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, task_type: value }))}
                options={taskTypeOptions}
              />
              {!selectedTaskSupported ? (
                <div className="errorText" style={{ marginTop: 8 }}>
                  当前模型不支持该任务模式，请切换模型或选择其他任务模式。
                </div>
              ) : null}
            </div>
            <div className="formGroup" style={{ gridColumn: "span 2" }}>
              <label className="formLabel">音频输入</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  icon={Music}
                  disabled={isUploadingMusicAsset}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {isUploadingMusicAsset ? "上传中..." : "上传音频到资产库"}
                </Button>
                <Button
                  variant="ghost"
                  icon={RefreshCw}
                  disabled={isUploadingMusicAsset}
                  onClick={refreshAssets}
                >
                  刷新资产
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
              <label className="formLabel">源音频资产</label>
              <Select
                value={form.source_asset_name}
                onValueChange={(value) => setForm((prev) => ({ ...prev, source_asset_name: value }))}
                options={assetOptions}
              />
            </div>
          ) : null}

          {needsReferenceAsset ? (
            <div className="formGroup">
              <label className="formLabel">参考音频资产</label>
              <Select
                value={form.reference_asset_name}
                onValueChange={(value) => setForm((prev) => ({ ...prev, reference_asset_name: value }))}
                options={assetOptions}
              />
            </div>
          ) : null}

          {needsTrackName && taskType === "extract" ? (
            <div className="formGroup">
              <label className="formLabel">轨道类型</label>
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
                <label className="formLabel">轨道类型</label>
                <Select
                  value={form.track_name}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, track_name: value }))}
                  options={TRACK_NAME_OPTIONS}
                />
              </div>
              <div className="formGroup" style={{ gridColumn: "span 2" }}>
                <label className="formLabel">轨道名称（可编辑）</label>
                <input
                  className="textInput"
                  value={form.track_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, track_name: event.target.value }))}
                  placeholder="例如 vocals"
                />
              </div>
            </div>
          ) : null}

          {taskType === "complete" ? (
            <div className="formGroup">
              <label className="formLabel">补全轨道类别（可选）</label>
              <input
                className="textInput"
                value={form.complete_track_classes}
                onChange={(event) => setForm((prev) => ({ ...prev, complete_track_classes: event.target.value }))}
                placeholder="例如 vocals, drums"
              />
            </div>
          ) : null}

          {needsRepaintRange ? (
            <div className="editorGrid two">
              <div className="formGroup">
                <label className="formLabel">重绘起点（秒）</label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.repainting_start}
                  onChange={(event) => setForm((prev) => ({ ...prev, repainting_start: event.target.value }))}
                  placeholder="留空从头开始"
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">重绘终点（秒）</label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.repainting_end}
                  onChange={(event) => setForm((prev) => ({ ...prev, repainting_end: event.target.value }))}
                  placeholder="留空到结束"
                />
              </div>
            </div>
          ) : null}

          {hideTextMusicInputs ? null : (
            <>
              <div className="formGroup">
                <label className="formLabel">音乐描述（必填）</label>
                <textarea
                  className="textArea musicPromptArea"
                  value={form.prompt}
                  onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))}
                  placeholder="例如：温暖钢琴与弦乐，电影感，60 秒，适合旁白背景…"
                />
              </div>

              <div className="editorGrid three musicCompactGrid">
                <div className="formGroup">
                  <label className="formLabel">时长（秒）</label>
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
                  <label className="formLabel">推理步数</label>
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
                  <label className="formLabel">语言</label>
                  <Select
                    value={form.vocal_language}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, vocal_language: value }))}
                    options={LANGUAGE_OPTIONS}
                  />
                </div>
              </div>
            </>
          )}

          <div className="musicCollapsibleBlock musicAdvancedBlock">
            <div className="musicInlineHeader">
              <div>
                <div className="musicInlineTitle">高级音乐参数</div>
                <div className="musicInlineMeta">Seed、BPM、歌词、CFG 与轨道细节</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={isAdvancedMusicOpen ? ChevronUp : ChevronDown}
                aria-expanded={isAdvancedMusicOpen}
                onClick={() => setIsAdvancedMusicOpen((prev) => !prev)}
              >
                {isAdvancedMusicOpen ? "收起" : "展开"}
              </Button>
            </div>
            {isAdvancedMusicOpen ? (
              <>
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
                      <div className="secondary" style={{ marginTop: 6 }}>Turbo 模型不支持 CFG，已自动关闭</div>
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
                      {isTurboModel ? "Turbo：固定使用 1 / 2 / 3 三档" : "Base：建议 1.0 - 5.0"}
                    </div>
                  </div>
                  {taskType === "extract" ? (
                    <div className="formGroup">
                      <label className="formLabel">推理步数</label>
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
                      <label className="formLabel">Cover 强度</label>
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
                      <label className="formLabel">歌词（可选，留空可自动）</label>
                      <textarea
                        className="textArea compactArea"
                        value={form.lyrics}
                        onChange={(event) => setForm((prev) => ({ ...prev, lyrics: event.target.value }))}
                        placeholder="纯音乐可填 [Instrumental]…"
                      />
                    </div>

              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">Seed（可选）</label>
                  <input
                    className="textInput"
                    type="number"
                    step="1"
                    value={form.seed}
                    onChange={(event) => setForm((prev) => ({ ...prev, seed: event.target.value }))}
                    placeholder="留空随机"
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">BPM（可选）</label>
                  <Select
                    value={displayBpmValue}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, bpm: value }))}
                    options={BPM_OPTIONS}
                  />
                </div>
                <div className="formGroup">
                  <label className="formLabel">调式（可选）</label>
                  <Select
                    value={form.keyscale}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, keyscale: value }))}
                    options={KEYSCALE_OPTIONS}
                  />
                </div>
              </div>

              <div className="formGroup">
                <label className="formLabel">拍号（可选）</label>
                <Select
                  value={form.timesignature}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, timesignature: value }))}
                  options={TIMESIGNATURE_OPTIONS}
                />
              </div>
                  </>
                )}
              </>
            ) : null}
          </div>

          {hideTextMusicInputs ? (
            <div className="controlRow">
              <Button
                variant="primary"
                disabled={isSubmitting || !musicEnabled || ACTIVE_MUSIC_STATUSES.has(taskStatus) || !selectedTaskSupported}
                onClick={handleGenerate}
              >
                {isSubmitting ? "提交中..." : "开始生成"}
              </Button>
            </div>
          ) : (
            <div className="controlRow">
              <Button
                variant="primary"
                disabled={isSubmitting || !musicEnabled || ACTIVE_MUSIC_STATUSES.has(taskStatus) || !selectedTaskSupported}
                onClick={handleGenerate}
              >
                {isSubmitting ? "提交中..." : "开始生成"}
              </Button>
              <Button
                variant="secondary"
                disabled={!taskId || !ACTIVE_MUSIC_STATUSES.has(taskStatus) || isCancelling}
                onClick={handleCancel}
              >
                {isCancelling ? "取消中..." : "取消任务"}
              </Button>
              <Button variant="ghost" icon={RefreshCw} onClick={refreshAssets}>
                刷新资产
              </Button>
            </div>
          )}
        </GlassCard>

        <GlassCard className="musicStatusCard">
          <div className="musicStatusCompactHeader">
            <div className="musicStatusHeadline">
              <span className="musicStatusKicker">运行状态</span>
              <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
              <span className="musicStatusSummary">
                {taskStage || (taskId ? `任务 ${taskId}` : currentProject?.name ? currentProject.name : "等待生成")}
              </span>
            </div>
            <div className="musicStatusActions">
              <span className={validation?.valid ? "musicStatusTinyOk" : "musicStatusTinyWarn"}>
                模型{validation?.valid ? "通过" : "待校验"}
              </span>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refreshValidation} disabled={isValidating}>
                校验
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={isStatusDetailOpen ? ChevronUp : ChevronDown}
                aria-expanded={isStatusDetailOpen}
                aria-controls="music-status-details"
                onClick={() => setIsStatusDetailOpen((prev) => !prev)}
              >
                详情
              </Button>
            </div>
          </div>

          {taskError ? (
            <div className="musicStatusError">{taskError}</div>
          ) : null}
          {validation?.message && !validation?.valid ? (
            <div className="musicStatusError">{validation.message}</div>
          ) : null}
          {showConflictHint && taskId ? (
            <div className="controlRow musicStatusConflict">
              <Button variant="ghost" size="sm" onClick={focusStatusCard}>
                定位当前任务
              </Button>
            </div>
          ) : null}

          {isStatusDetailOpen ? (
            <div id="music-status-details" className="musicStatusGrid">
              <div className="musicStatusItem">
                <span>Music 启用</span>
                <strong className={musicEnabled ? "musicStatusOk" : "musicStatusWarn"}>{musicEnabled ? "yes" : "no"}</strong>
              </div>
              <div className="musicStatusItem">
                <span>模型校验</span>
                <strong className={validation?.valid ? "musicStatusOk" : "musicStatusWarn"}>{validation?.valid ? "通过" : "未通过"}</strong>
              </div>
              <div className="musicStatusItem">
                <span>模型类型</span>
                <strong>{validation ? (validation.is_turbo ? "Turbo" : "Base / SFT") : "-"}</strong>
              </div>
              <div className="musicStatusItem">
                <span>当前项目</span>
                <strong title={currentProject?.name || ""}>{currentProject?.name || "未选择"}</strong>
              </div>
              <div className="musicStatusItem wide">
                <span>任务 ID</span>
                <strong className="musicMonoValue" translate="no">{taskId || "-"}</strong>
              </div>
              <div className="musicStatusItem wide">
                <span>阶段</span>
                <strong>{taskStage || "-"}</strong>
              </div>
              <div className="musicStatusItem wide">
                <span>模型目录</span>
                <strong title={validation?.model_dir || ""} translate="no">{validation?.model_dir || "未配置"}</strong>
              </div>
              <div className="musicStatusItem wide">
                <span>支持任务</span>
                <strong>
                  {Array.isArray(validation?.supported_task_types) && validation.supported_task_types.length
                    ? validation.supported_task_types.join(", ")
                    : "-"}
                </strong>
              </div>
              {validation?.message && validation?.valid ? (
                <div className="musicStatusNote">{validation.message}</div>
              ) : null}
              {Array.isArray(validation?.missing) && validation.missing.length ? (
                <div className="codeBlock musicStatusCode">{validation.missing.join("\n")}</div>
              ) : null}
              {taskStatus === "canceled" && taskCancelMessage ? (
                <div className="listStack" style={{ marginTop: 8, gap: 6 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={cancelDetailOpen ? ChevronUp : ChevronDown}
                    onClick={() => setCancelDetailOpen((prev) => !prev)}
                  >
                    取消详情
                  </Button>
                  {cancelDetailOpen ? (
                    <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
                      {taskCancelMessage}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </GlassCard>
      </div>

      <GlassCard className="musicPreviewCard">
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">试听</h2>
            <div className="secondary">{previewAssetName || "暂无选中资产"}</div>
          </div>
          {currentResultAssetName ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Download}
              onClick={() => downloadAudioUrl(buildAssetAudioUrl(currentResultAssetName), currentResultAssetName)}
            >
              下载当前结果
            </Button>
          ) : null}
        </div>
        {previewAudioUrl ? (
          <div className="musicPreviewLayout">
            <AudioPlayer
              audioUrl={previewAudioUrl}
              compact
              autoPlaySignal={previewAutoPlaySignal}
              pauseSignal={previewPauseSignal}
              onPlayStateChange={setIsPreviewPlaying}
            />
            {currentResultAssetName ? (
              <div className="controlRow musicPreviewActions">
                <Button
                  variant="secondary"
                  icon={Save}
                  disabled={attachingKey === `${currentResultAssetName}:bgm`}
                  onClick={() => handleAttach(currentResultAssetName, "bgm")}
                >
                  绑定为 BGM
                </Button>
                <Button
                  variant="secondary"
                  icon={Save}
                  disabled={attachingKey === `${currentResultAssetName}:ambience`}
                  onClick={() => handleAttach(currentResultAssetName, "ambience")}
                >
                  绑定为环境音
                </Button>
                <Button variant="ghost" onClick={() => onNavigate?.("synth")}>
                  前往合成页
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="emptyState">暂无可试听的音乐资产</div>
        )}
      </GlassCard>

        <GlassCard>
          <div ref={statusCardRef} />
          <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">音乐资产库</h2>
            <div className="secondary">
              {isLoadingAssets ? "刷新中..." : `显示 ${filteredAssets.length} / 共 ${assets.length} 条`}
            </div>
          </div>
          <div className="controlRow" style={{ justifyContent: "flex-end" }}>
            <Button
              variant="secondary"
              size="sm"
              icon={Music}
              disabled={isUploadingMusicAsset}
              onClick={() => uploadInputRef.current?.click()}
            >
              {isUploadingMusicAsset ? "上传中..." : "上传音频到资产库"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={isAssetLibraryOpen ? ChevronUp : ChevronDown}
              aria-expanded={isAssetLibraryOpen}
              onClick={() => setIsAssetLibraryOpen((prev) => !prev)}
            >
              {isAssetLibraryOpen ? "收起" : "展开"}
            </Button>
          </div>
        </div>
        {isAssetLibraryOpen ? (
          <>
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
                placeholder="新分类名称"
                style={{ maxWidth: 220 }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={isCreatingCategory}
                onClick={handleCreateCategory}
              >
                {isCreatingCategory ? "创建中..." : "新建分类"}
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
                          {categoryBusyId === `${category.id}:rename` ? "保存中..." : "保存"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={categoryBusyId === `${category.id}:rename`}
                          onClick={handleCancelRenameCategory}
                        >
                          取消
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
                              重命名
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              icon={Trash2}
                              disabled={categoryBusyId === `${category.id}:delete`}
                              onClick={() => handleDeleteCategory(category.id)}
                            >
                              {categoryBusyId === `${category.id}:delete` ? "删除中..." : "删除"}
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
                <span>还没有生成结果</span>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="emptyState">
                <span>该分类下暂无资产</span>
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
                        <div className="musicAssetCategoryTag">{item.category_name || categoryById[item.category_id]?.name || "未分类"}</div>
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
                            {renamingBusyAssetName === item.name ? "保存中..." : "保存"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={renamingBusyAssetName === item.name}
                            onClick={handleCancelRenameAsset}
                          >
                            取消
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
                            重命名
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={previewAssetName === item.name && isPreviewPlaying ? Pause : Play}
                            onClick={() => toggleAssetPreview(item.name)}
                          >
                            {previewAssetName === item.name && isPreviewPlaying ? "暂停" : "播放"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Download}
                            onClick={() => downloadAudioUrl(buildAssetAudioUrl(item.name), item.name)}
                          >
                            下载
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            icon={Trash2}
                            disabled={deletingAssetName === item.name || Boolean(categoryBusyId)}
                            onClick={() => handleDeleteAsset(item.name)}
                          >
                            {deletingAssetName === item.name ? "删除中..." : "删除"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={attachingKey === `${item.name}:bgm`}
                            onClick={() => handleAttach(item.name, "bgm")}
                          >
                            设为 BGM
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={attachingKey === `${item.name}:ambience`}
                            onClick={() => handleAttach(item.name, "ambience")}
                          >
                            设为环境音
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </GlassCard>
    </div>
  );
}
