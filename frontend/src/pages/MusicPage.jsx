import { Bot, ChevronDown, ChevronUp, Download, LoaderCircle, Music, Pause, Play, RefreshCw, Save, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
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

const DEFAULT_FORM = {
  prompt: "",
  lyrics: "",
  audio_duration: 30,
  vocal_language: "unknown",
  num_inference_steps: 8,
  seed: "",
  bpm: "",
  keyscale: "",
  timesignature: "",
};

const ACTIVE_STATUSES = new Set(["queued", "running", "cancel_requested"]);

const STATUS_META = {
  idle: { label: "空闲", tone: "default" },
  queued: { label: "排队中", tone: "warning" },
  running: { label: "生成中", tone: "warning" },
  cancel_requested: { label: "取消中", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  canceled: { label: "已取消", tone: "default" },
  error: { label: "失败", tone: "warning" },
};

const LANGUAGE_OPTIONS = [
  { value: "unknown", label: "自动/未知" },
  { value: "zh", label: "中文 (zh)" },
  { value: "en", label: "英文 (en)" },
  { value: "ja", label: "日文 (ja)" },
  { value: "ko", label: "韩文 (ko)" },
];

const BPM_OPTIONS = [
  { value: "", label: "不指定" },
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
  { value: "", label: "不指定" },
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
  { value: "", label: "不指定" },
  { value: "4/4", label: "4/4" },
  { value: "3/4", label: "3/4" },
  { value: "2/4", label: "2/4" },
  { value: "6/8", label: "6/8" },
  { value: "12/8", label: "12/8" },
  { value: "5/4", label: "5/4" },
  { value: "7/8", label: "7/8" },
];

const ASSIST_SOURCE_OPTIONS = [
  { value: "secondary_local", label: "小模型（本地）" },
  { value: "primary_local", label: "主模型（本地）" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
];

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
  const statusCardRef = useRef(null);

  const statusMeta = STATUS_META[taskStatus] || STATUS_META.idle;
  const musicEnabled = systemStatus?.config?.music_enabled !== false;
  const isMusicTaskActive = ACTIVE_STATUSES.has(taskStatus);
  const isAssistBusy = isAssistLoading || isAssistUnloading || isAssistChatting || isAssistFinalizing;
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
    } catch (error) {
      setValidation({
        valid: false,
        exists: false,
        missing: [],
        message: getErrorMessage(error, "模型目录校验失败"),
      });
    } finally {
      setIsValidating(false);
    }
  }

  async function refreshAssets() {
    setIsLoadingAssets(true);
    try {
      const payload = await api.get("/music/assets");
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setAssets(nextItems);
      if (!previewAssetName && nextItems.length > 0) {
        setPreviewAssetName(nextItems[0].name);
      }
    } catch (error) {
      pushToast({ title: `加载音乐资产失败：${getErrorMessage(error)}`, tone: "error" });
    } finally {
      setIsLoadingAssets(false);
    }
  }

  useEffect(() => {
    refreshSystemStatus();
    refreshAssistStatus();
    refreshValidation();
    refreshAssets();
  }, []);

  useEffect(() => {
    if (!currentResultAssetName) {
      return;
    }
    setPreviewAssetName(currentResultAssetName);
  }, [currentResultAssetName]);

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
      setForm((prev) => ({
        ...prev,
        prompt: String(result?.prompt || prev.prompt || ""),
        lyrics: String(result?.lyrics || ""),
        audio_duration: Number(result?.audio_duration || prev.audio_duration || 30),
        vocal_language: String(result?.vocal_language || prev.vocal_language || "unknown"),
        bpm: result?.bpm === null || result?.bpm === undefined ? "" : String(result.bpm),
        keyscale: result?.keyscale || "",
        timesignature: result?.timesignature || "",
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
    if (!form.prompt.trim()) {
      pushToast({ title: "请输入音乐描述", tone: "warning" });
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
      const payload = {
        prompt: form.prompt.trim(),
        project_id: currentProject?.id || null,
        lyrics: form.lyrics.trim(),
        audio_duration: Number(form.audio_duration),
        vocal_language: form.vocal_language.trim() || "unknown",
        num_inference_steps: Number(form.num_inference_steps),
        seed: toNumberOrNull(form.seed),
        bpm: toNumberOrNull(form.bpm),
        keyscale: form.keyscale.trim() || null,
        timesignature: form.timesignature.trim() || null,
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
    if (!taskId || !ACTIVE_STATUSES.has(taskStatus)) {
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
    const confirmed = window.confirm(`确认删除音乐资产 ${assetName} 吗？`);
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
      <div className="pageGrid twoCols">
        <GlassCard>
          <h2 className="cardTitle">
            <Music size={16} /> 音乐生成
          </h2>
          <p className="cardSubtitle">
            使用已配置的 ACE-Step Diffusers 本地模型生成音乐，不自动下载模型。
          </p>

          <div className="musicAssistPanel">
            <div className="sectionHeader" style={{ marginBottom: 8 }}>
              <h3 className="cardTitle" style={{ fontSize: 14 }}>
                <Bot size={16} /> AI 音乐助手（对话模式）
              </h3>
              <div className="secondary">
                {assistStatus?.loaded ? `已加载：${assistStatus?.source || "-"}` : "未加载"}
              </div>
            </div>
            <div className="editorGrid three" style={{ marginBottom: 8 }}>
              <div className="formGroup" style={{ gridColumn: "span 2" }}>
                <label className="formLabel">LLM 来源</label>
                <Select value={assistSource} onValueChange={setAssistSource} options={ASSIST_SOURCE_OPTIONS} />
              </div>
              <div className="formGroup">
                <label className="formLabel">助手状态</label>
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
                {isAssistLoading ? <><LoaderCircle size={14} className="spin" /> 加载中...</> : "加载模型"}
              </Button>
              <Button
                variant="ghost"
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded}
                onClick={handleAssistUnload}
              >
                {isAssistUnloading ? <><LoaderCircle size={14} className="spin" /> 卸载中...</> : "卸载模型"}
              </Button>
              <Button
                variant="primary"
                icon={Sparkles}
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || assistMessages.length === 0}
                onClick={handleAssistFinalize}
              >
                {isAssistFinalizing ? "填入中..." : "生成并填入"}
              </Button>
              <Button
                variant="ghost"
                icon={Trash2}
                disabled={isAssistBusy || isMusicTaskActive}
                onClick={handleClearAssistConversation}
              >
                删除对话
              </Button>
            </div>
            <div className="musicAssistMessages">
              {assistMessages.map((item, index) => (
                <div key={`${item.role}-${index}`} className={`musicAssistMessage ${item.role}`}>
                  <div className="musicAssistRole">{item.role === "assistant" ? "助手" : "你"}</div>
                  <div className="musicAssistContent">{item.content}</div>
                </div>
              ))}
            </div>
            <div className="musicAssistComposer">
              <textarea
                className="textArea compactArea"
                value={assistInput}
                onChange={(event) => setAssistInput(event.target.value)}
                placeholder="例如：我要做温暖电影感钢琴配乐，30秒，适合女性旁白开场"
              />
              <Button
                variant="secondary"
                icon={SendHorizontal}
                disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || !assistInput.trim()}
                onClick={handleAssistSend}
              >
                {isAssistChatting ? "发送中..." : "发送"}
              </Button>
            </div>
            {assistStatus?.error ? (
              <div className="errorText">{assistStatus.error}</div>
            ) : null}
          </div>

          <div className="formGroup">
            <label className="formLabel">音乐描述（必填）</label>
            <textarea
              className="textArea"
              value={form.prompt}
              onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))}
              placeholder="例如：温暖钢琴与弦乐，电影感，60 秒，适合旁白背景"
              style={{ minHeight: 108 }}
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">歌词（可选，留空可自动）</label>
            <textarea
              className="textArea compactArea"
              value={form.lyrics}
              onChange={(event) => setForm((prev) => ({ ...prev, lyrics: event.target.value }))}
              placeholder="纯音乐可填 [Instrumental]"
            />
          </div>

          <div className="editorGrid three">
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
                min="1"
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
                value={form.bpm}
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

          <div className="controlRow">
            <Button
              variant="primary"
              disabled={isSubmitting || !musicEnabled || ACTIVE_STATUSES.has(taskStatus)}
              onClick={handleGenerate}
            >
              {isSubmitting ? "提交中..." : "开始生成"}
            </Button>
            <Button
              variant="secondary"
              disabled={!taskId || !ACTIVE_STATUSES.has(taskStatus) || isCancelling}
              onClick={handleCancel}
            >
              {isCancelling ? "取消中..." : "取消任务"}
            </Button>
            <Button variant="ghost" icon={RefreshCw} onClick={refreshAssets}>
              刷新资产
            </Button>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="sectionHeader">
            <h2 className="cardTitle">运行状态</h2>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refreshValidation} disabled={isValidating}>
              校验模型目录
            </Button>
          </div>

          <div className="listStack">
            <div className="statRow">
              <span>任务状态</span>
              <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
            </div>
            <div className="statRow">
              <span>Music 启用</span>
              <strong style={{ color: musicEnabled ? "var(--success)" : "var(--warning)" }}>
                {musicEnabled ? "yes" : "no"}
              </strong>
            </div>
            <div className="statRow">
              <span>任务 ID</span>
              <strong style={{ fontFamily: "monospace", fontSize: 11.5 }}>
                {taskId || "-"}
              </strong>
            </div>
            <div className="statRow">
              <span>阶段</span>
              <strong>{taskStage || "-"}</strong>
            </div>
            <div className="statRow">
              <span>当前项目</span>
              <strong>{currentProject?.name || "未选择"}</strong>
            </div>
            <div className="statRow">
              <span>模型目录</span>
              <strong title={validation?.model_dir || ""} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {validation?.model_dir || "未配置"}
              </strong>
            </div>
            <div className="statRow">
              <span>模型校验</span>
              <strong style={{ color: validation?.valid ? "var(--success)" : "var(--warning)" }}>
                {validation?.valid ? "通过" : "未通过"}
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
                  定位当前任务
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

          {previewAudioUrl ? (
            <div className="listStack">
              <div className="formLabel">试听</div>
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
                    下载当前结果
                  </Button>
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
                  <Button
                    variant="ghost"
                    onClick={() => onNavigate?.("synth")}
                  >
                    前往合成页
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="emptyState">暂无可试听的音乐资产</div>
          )}
        </GlassCard>
      </div>

        <GlassCard>
          <div ref={statusCardRef} />
          <div className="sectionHeader">
          <h2 className="cardTitle">音乐资产库</h2>
          <div className="secondary">{isLoadingAssets ? "刷新中..." : `共 ${assets.length} 条`}</div>
        </div>
        {assets.length === 0 ? (
          <div className="emptyState">
            <span>还没有生成结果</span>
          </div>
        ) : (
          <div className="musicAssetList">
            {assets.map((item) => (
              <div key={item.name} className={`musicAssetRow ${previewAssetName === item.name ? "active" : ""}`}>
                <button
                  className="musicAssetMeta"
                  onClick={() => setPreviewAssetName(item.name)}
                  type="button"
                >
                  <div className="musicAssetName">{item.name}</div>
                  <div className="musicAssetSub">
                    <span>{formatFileSize(item.size)}</span>
                    <span>{formatDateTime(item.updated_at)}</span>
                  </div>
                </button>
                <div className="controlRow" style={{ justifyContent: "flex-end" }}>
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
                    disabled={deletingAssetName === item.name}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
