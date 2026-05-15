import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AsrRecognitionCard from "../components/speech/AsrRecognitionCard";
import RecognitionPreviewCard from "../components/speech/RecognitionPreviewCard";
import SpeechProjectToolbarSection from "../components/speech/SpeechProjectToolbarSection";
import SpeechUtilityTabs from "../components/speech/SpeechUtilityTabs";
import DubbingProjectTargetDialog from "../components/text/DubbingProjectTargetDialog";
import { useProjectStore } from "../stores/useProjectStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSpeechRecognitionStore } from "../stores/useSpeechRecognitionStore";
import { useUiStore } from "../stores/useUiStore";
import { API_BASE_URL, getWsBaseUrl } from "../utils/api";
import { buildProjectFilePayload, openProjectFileWithPicker, saveProjectFile } from "../utils/projectFile";
import {
  buildProjectOption,
  getProjectSourceTag,
  getSameNameSiblingProjects,
  shortProjectId,
  toProjectFileDisplayName,
} from "../utils/projectToolbar";
import {
  buildDubbingProjectName,
  buildDubbingSegmentsFromPreview,
  buildTranslatedDubbingScriptPayload,
  collapseWhisperSegments,
  formatTimestamp,
  renderCuesAsSrt,
  stripTimelineText,
  getDubbingTaskLabel,
  validateEditedSubtitleSrt,
} from "../utils/speechRecognitionFormat";
import { runTaskChannel } from "../utils/taskChannel";
import { appendSpeechText, replaceSpeechText } from "../utils/speechText";

export default function SpeechRecognitionPage({ onNavigate }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isBuildingDubbingProject, setIsBuildingDubbingProject] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameProjectName, setRenameProjectName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectTask, setProjectTask] = useState({ status: "", failedChunks: [], warnings: [], chunkProgress: null, parseTaskId: "" });
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const abortRef = useRef(null);
  const translateAbortRef = useRef(null);
  const subtitleTranslateAbortRef = useRef(null);
  const archiveInputRef = useRef(null);
  const projectFileInputRef = useRef(null);
  const speakerLabels = useSpeechRecognitionStore((state) => state.speakerLabels);
  const setSpeakerLabels = useSpeechRecognitionStore((state) => state.setSpeakerLabels);
  const transcript = useSpeechRecognitionStore((state) => state.transcript);
  const setTranscript = useSpeechRecognitionStore((state) => state.setTranscript);
  const plainText = useSpeechRecognitionStore((state) => state.plainText);
  const setPlainText = useSpeechRecognitionStore((state) => state.setPlainText);
  const warnings = useSpeechRecognitionStore((state) => state.warnings);
  const setWarnings = useSpeechRecognitionStore((state) => state.setWarnings);
  const alignments = useSpeechRecognitionStore((state) => state.alignments);
  const setAlignments = useSpeechRecognitionStore((state) => state.setAlignments);
  const speakerMap = useSpeechRecognitionStore((state) => state.speakerMap);
  const setSpeakerMap = useSpeechRecognitionStore((state) => state.setSpeakerMap);
  const updateSpeakerMapEntry = useSpeechRecognitionStore((state) => state.updateSpeakerMapEntry);
  const showTimeline = useSpeechRecognitionStore((state) => state.showTimeline);
  const setShowTimeline = useSpeechRecognitionStore((state) => state.setShowTimeline);
  const error = useSpeechRecognitionStore((state) => state.error);
  const setError = useSpeechRecognitionStore((state) => state.setError);
  const backendUsed = useSpeechRecognitionStore((state) => state.backendUsed);
  const setBackendUsed = useSpeechRecognitionStore((state) => state.setBackendUsed);
  const modelFiles = useSpeechRecognitionStore((state) => state.modelFiles);
  const setModelFiles = useSpeechRecognitionStore((state) => state.setModelFiles);
  const translationSource = useSpeechRecognitionStore((state) => state.translationSource);
  const setTranslationSource = useSpeechRecognitionStore((state) => state.setTranslationSource);
  const translationMode = useSpeechRecognitionStore((state) => state.translationMode);
  const setTranslationMode = useSpeechRecognitionStore((state) => state.setTranslationMode);
  const translationTargetLanguage = useSpeechRecognitionStore((state) => state.translationTargetLanguage);
  const setTranslationTargetLanguage = useSpeechRecognitionStore((state) => state.setTranslationTargetLanguage);
  const asrBackend = useSpeechRecognitionStore((state) => state.asrBackend);
  const setAsrBackend = useSpeechRecognitionStore((state) => state.setAsrBackend);
  const asrLanguage = useSpeechRecognitionStore((state) => state.asrLanguage);
  const setAsrLanguage = useSpeechRecognitionStore((state) => state.setAsrLanguage);
  const asrEnableTimestamps = useSpeechRecognitionStore((state) => state.asrEnableTimestamps);
  const setAsrEnableTimestamps = useSpeechRecognitionStore((state) => state.setAsrEnableTimestamps);
  const translationResult = useSpeechRecognitionStore((state) => state.translationResult);
  const setTranslationResult = useSpeechRecognitionStore((state) => state.setTranslationResult);
  const translationError = useSpeechRecognitionStore((state) => state.translationError);
  const setTranslationError = useSpeechRecognitionStore((state) => state.setTranslationError);
  const translationEngineStatus = useSpeechRecognitionStore((state) => state.translationEngineStatus);
  const setTranslationEngineStatus = useSpeechRecognitionStore((state) => state.setTranslationEngineStatus);
  const clearTranslationResult = useSpeechRecognitionStore((state) => state.clearTranslationResult);
  const clearResult = useSpeechRecognitionStore((state) => state.clearResult);
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentProjectFileHandle = useProjectStore((state) => state.currentProjectFileHandle);
  const currentProjectFileName = useProjectStore((state) => state.currentProjectFileName);
  const bindCurrentProjectFile = useProjectStore((state) => state.bindCurrentProjectFile);
  const projects = useProjectStore((state) => state.projects);
  const projectSources = useProjectStore((state) => state.projectSources);
  const importWarnings = useProjectStore((state) => state.importWarnings);
  const createProject = useProjectStore((state) => state.createProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const importArchive = useProjectStore((state) => state.importArchive);
  const importProjectFile = useProjectStore((state) => state.importProjectFile);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadProjectScript = useScriptStore((state) => state.loadProjectScript);
  const saveScript = useScriptStore((state) => state.saveScript);
  const script = useScriptStore((state) => state.script);
  const loadProjectParseQc = useProjectStore((state) => state.loadProjectParseQc);
  const sourceText = useScriptStore((state) => state.sourceText);
  const setSourceText = useScriptStore((state) => state.setSourceText);
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);
  const systemStatus = useSettingsStore((state) => state.systemStatus);
  const refreshSystemStatus = useSettingsStore((state) => state.refreshSystemStatus);
  const [isLoadingTranslationEngine, setIsLoadingTranslationEngine] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [utilityTab, setUtilityTab] = useState("translate");
  const [subtitleFile, setSubtitleFile] = useState(null);
  const [subtitleMode, setSubtitleMode] = useState("original");
  const [subtitleLinePolicy, setSubtitleLinePolicy] = useState("auto");
  const [subtitleProjectName, setSubtitleProjectName] = useState("");
  const [subtitlePreview, setSubtitlePreview] = useState(null);
  const [subtitleError, setSubtitleError] = useState("");
  const [isPreviewingSubtitle, setIsPreviewingSubtitle] = useState(false);
  const [isTranslatingSubtitle, setIsTranslatingSubtitle] = useState(false);
  const [isCreatingSubtitleProject, setIsCreatingSubtitleProject] = useState(false);
  const [dubbingProjectDialog, setDubbingProjectDialog] = useState({
    open: false,
    kindLabel: "",
    defaultName: "",
    resolver: null,
  });
  const [editedPreviewText, setEditedPreviewText] = useState("");
  const [editedSubtitleSrtText, setEditedSubtitleSrtText] = useState("");
  const [dubbingTask, setDubbingTask] = useState({ taskId: "", status: "", stageLabel: "", processed: 0, total: 0, percent: 0, cacheHits: 0 });
  const dubbingTaskIdRef = useRef("");
  const [subtitleTask, setSubtitleTask] = useState({ taskId: "", status: "", stageLabel: "", processed: 0, total: 0, percent: 0, cacheHits: 0 });
  const subtitleTaskIdRef = useRef("");
  const isTranslationEngineLoaded = Boolean(translationEngineStatus?.loaded);
  const isProjectOpsBusy = isTranscribing || isRecording || isCreatingProject || isBuildingDubbingProject || isCreatingSubtitleProject || isTranslatingSubtitle;

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || "")),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    let nextVisible = sortedProjects.slice(0, 20);
    if (currentProject?.id && !nextVisible.some((item) => item.id === currentProject.id)) {
      const currentSummary = sortedProjects.find((item) => item.id === currentProject.id);
      if (currentSummary) {
        nextVisible = [currentSummary, ...nextVisible.slice(0, 19)];
      }
    }
    return nextVisible;
  }, [currentProject?.id, sortedProjects]);
  const projectOptions = useMemo(
    () => visibleProjects.map((project) => buildProjectOption(project, projectSources?.[project.id])),
    [projectSources, visibleProjects],
  );
  const sameNameSiblingProjects = useMemo(
    () => getSameNameSiblingProjects(projects, currentProject),
    [projects, currentProject],
  );
  const currentProjectMeta = useMemo(() => {
    if (!currentProject?.id) {
      return { sourceTag: "未选择", detail: "未选择项目" };
    }
    const sourceTag = getProjectSourceTag(projectSources?.[currentProject.id]);
    const detailParts = [];
    const fileName = toProjectFileDisplayName(currentProjectFileName || currentProject.project_file_name);
    if (fileName) {
      detailParts.push(fileName);
    }
    detailParts.push(`#${shortProjectId(currentProject.id)}`);
    return {
      sourceTag,
      detail: detailParts.join(" · "),
    };
  }, [currentProject, currentProjectFileName, projectSources]);

  const remappedAlignments = useMemo(() => {
    if (!Array.isArray(alignments) || !alignments.length) return [];
    return alignments.map((item) => {
      const rawSpeaker = String(item?.speaker || "").trim();
      const mapped = String(speakerMap?.[rawSpeaker] || rawSpeaker).trim() || rawSpeaker;
      return {
        ...item,
        speaker: mapped,
      };
    });
  }, [alignments, speakerMap]);

  const mappedTranscript = useMemo(() => {
    if (!speakerLabels) return transcript;
    if (!remappedAlignments.length) return transcript;
    return remappedAlignments
      .map((item) => {
        const text = String(item?.text || "").trim();
        if (!text) return "";
        const speaker = String(item?.speaker || "").trim();
        return speaker ? `${speaker}：${text}` : text;
      })
      .filter(Boolean)
      .join("\n");
  }, [remappedAlignments, speakerLabels, transcript]);

  const mappedTimelineText = useMemo(() => {
    if (!Array.isArray(remappedAlignments) || !remappedAlignments.length) return "";
    return remappedAlignments
      .map((item) => {
        const text = String(item?.text || "").trim();
        if (!text) return "";
        const start = formatTimestamp(item?.start_ms);
        const end = formatTimestamp(item?.end_ms);
        const speaker = String(item?.speaker || "").trim();
        const body = speakerLabels && speaker ? `${speaker}：${text}` : text;
        return `[${start} --> ${end}] ${body}`;
      })
      .filter(Boolean)
      .join("\n");
  }, [remappedAlignments, formatTimestamp, speakerLabels]);

  const asrBackendConfigured = asrBackend === "qwen3_crispasr" ? "qwen3_crispasr" : "whisper";
  const asrLanguageOptions = useMemo(() => [
    { value: "auto", label: "自动" },
    { value: "zh", label: "中文" },
    { value: "en", label: "英文" },
    { value: "ja", label: "日文" },
    { value: "ko", label: "韩文" },
    { value: "fr", label: "法文" },
    { value: "de", label: "德文" },
    { value: "es", label: "西班牙文" },
    { value: "ru", label: "俄文" },
  ], []);
  const derivedPreviewText = showTimeline && mappedTimelineText
    ? mappedTimelineText
    : (speakerLabels
      ? mappedTranscript
      : (asrBackendConfigured === "whisper" ? collapseWhisperSegments(plainText) : plainText));
  const previewText = editedPreviewText;
  const translationPlainInputText = stripTimelineText(editedPreviewText);
  const canInsert = useMemo(() => Boolean((previewText || "").trim()), [previewText]);
  const canInsertTranslation = useMemo(() => Boolean((translationResult || "").trim()), [translationResult]);
  const isQwen3Backend = asrBackendConfigured === "qwen3_crispasr";
  const qwen3Ready = Boolean(systemStatus?.qwen3_asr_ready);
  const asrUnavailableReason = useMemo(() => {
    if (asrBackendConfigured !== "qwen3_crispasr") return "";
    if (qwen3Ready) return "";
    return "Qwen3-ASR (CrispASR) 未就绪，请在系统设置补全可执行文件与 GGUF 模型路径。";
  }, [asrBackendConfigured, qwen3Ready]);
  const showTimestampToggle = asrBackendConfigured === "qwen3_crispasr";
  const effectiveAsrEnableTimestamps = !isQwen3Backend && Boolean(asrEnableTimestamps);
  const speakerLabelHint = useMemo(() => {
    if (!speakerLabels) return "";
    if (asrBackendConfigured === "qwen3_crispasr") {
      return "已为 Qwen3-ASR 自动开启时间戳，用于说话人标签对齐。";
    }
    return "Whisper + pyannote 会自动使用时间轴进行说话人标签对齐。";
  }, [speakerLabels, asrBackendConfigured]);
  const canBuildDubbingProject = useMemo(
    () => Boolean((translationMode === "passthrough" || isTranslationEngineLoaded) && remappedAlignments.length && !isQwen3Backend),
    [isTranslationEngineLoaded, remappedAlignments.length, isQwen3Backend, translationMode],
  );
  const subtitleTranslationReady = useMemo(
    () => subtitleMode !== "translated" || (isTranslationEngineLoaded && translationEngineStatus?.source === translationSource),
    [isTranslationEngineLoaded, subtitleMode, translationEngineStatus?.source, translationSource],
  );
  const subtitleCreateDisabledReason = useMemo(() => {
    if (!subtitleFile) return "请先上传 SRT 或 ASS 字幕。";
    if (subtitleMode === "translated" && !isTranslationEngineLoaded) return "请先加载翻译引擎。";
    if (subtitleMode === "translated" && translationEngineStatus?.source !== translationSource) return "翻译引擎来源与当前选择不一致。";
    if (subtitleMode === "translated" && !Array.isArray(subtitlePreview?.translated_segments)) return "请先点击“翻译字幕”，确认预览结果后再创建项目。";
    if (isPreviewingSubtitle) return "正在解析字幕。";
    if (isTranslatingSubtitle) return "正在翻译字幕。";
    if (isCreatingSubtitleProject) return "正在创建项目。";
    return "";
  }, [isCreatingSubtitleProject, isPreviewingSubtitle, isTranslatingSubtitle, isTranslationEngineLoaded, subtitleFile, subtitleMode, subtitlePreview?.translated_segments, translationEngineStatus?.source, translationSource]);
  const canCreateSubtitleProject = Boolean(
    subtitleFile &&
    subtitleTranslationReady &&
    !isPreviewingSubtitle &&
    !isTranslatingSubtitle &&
    !isCreatingSubtitleProject &&
    (subtitleMode !== "translated" || Array.isArray(subtitlePreview?.translated_segments))
  );

  const requestDubbingProjectTarget = useCallback(({ kindLabel, defaultName }) => (
    new Promise((resolve) => {
      setDubbingProjectDialog({
        open: true,
        kindLabel,
        defaultName,
        resolver: resolve,
      });
    })
  ), []);

  const resolveDubbingProjectTarget = useCallback((value) => {
    setDubbingProjectDialog((current) => {
      current.resolver?.(value);
      return {
        open: false,
        kindLabel: "",
        defaultName: "",
        resolver: null,
      };
    });
  }, []);

  const parseEditedPreviewDubbingSegments = useCallback(() => {
    return buildDubbingSegmentsFromPreview({
      alignments: remappedAlignments,
      previewText: editedPreviewText,
    });
  }, [editedPreviewText, remappedAlignments]);

  useEffect(() => {
    if (isQwen3Backend) {
      if (speakerLabels) setSpeakerLabels(false);
      if (showTimeline) setShowTimeline(false);
      if (asrEnableTimestamps) setAsrEnableTimestamps(false);
      return;
    }
    if (asrBackendConfigured === "whisper" && asrEnableTimestamps) {
      setAsrEnableTimestamps(false);
    }
  }, [isQwen3Backend, speakerLabels, showTimeline, asrBackendConfigured, asrEnableTimestamps, setAsrEnableTimestamps, setSpeakerLabels, setShowTimeline]);

  useEffect(() => {
    setEditedPreviewText(derivedPreviewText || "");
  }, [derivedPreviewText]);

  async function readErrorMessage(response, fallback) {
    const raw = await response.text();
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return String(parsed?.detail || parsed?.message || raw);
    } catch {
      return raw;
    }
  }

  async function previewSubtitleFile(nextFile = subtitleFile, nextMode = subtitleMode, nextLinePolicy = subtitleLinePolicy, useEditedText = false) {
    if (!nextFile) {
      setSubtitlePreview(null);
      return null;
    }
    setIsPreviewingSubtitle(true);
    setSubtitleError("");
    try {
      const formData = new FormData();
      formData.append("file", nextFile, nextFile.name || "subtitle.srt");
      if (useEditedText && editedSubtitleSrtText.trim()) {
        formData.append("subtitle_text", validateEditedSubtitleSrt(editedSubtitleSrtText));
      }
      formData.append("mode", nextMode || "original");
      formData.append("line_policy", nextLinePolicy || "auto");
      const response = await fetch(`${API_BASE_URL}/subtitles/preview`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      setSubtitlePreview(payload);
      setEditedSubtitleSrtText(renderCuesAsSrt(payload?.cues || []));
      return payload;
    } catch (err) {
      const message = err?.message || "字幕解析失败";
      setSubtitleError(message);
      setSubtitlePreview(null);
      return null;
    } finally {
      setIsPreviewingSubtitle(false);
    }
  }

  async function handleSubtitleFileChange(event) {
    const file = event.target.files?.[0] || null;
    setSubtitleFile(file);
    setSubtitleError("");
    setSubtitlePreview(null);
    setEditedSubtitleSrtText("");
    if (file) {
      const stem = String(file.name || "").replace(/\.[^.]+$/, "");
      setSubtitleProjectName((current) => current || (stem ? `${stem}-字幕配音` : ""));
      await previewSubtitleFile(file, subtitleMode, subtitleLinePolicy);
    }
  }

  async function handleSubtitleModeChange(value) {
    setSubtitleMode(value);
    if (subtitleFile) {
      await previewSubtitleFile(subtitleFile, value, subtitleLinePolicy);
    }
  }

  async function handleSubtitleLinePolicyChange(value) {
    setSubtitleLinePolicy(value);
    if (subtitleFile) {
      await previewSubtitleFile(subtitleFile, subtitleMode, value);
    }
  }

  async function handleCreateSubtitleDubbingProject() {
    if (!subtitleFile) {
      setSubtitleError("请先上传 SRT 或 ASS 字幕。");
      return;
    }
    if (!canCreateSubtitleProject) {
      setSubtitleError(subtitleCreateDisabledReason || "当前不能创建字幕配音项目。");
      return;
    }
    setIsCreatingSubtitleProject(true);
    setSubtitleError("");
    try {
      const target = await requestDubbingProjectTarget({
        kindLabel: "创建字幕配音项目",
        defaultName: subtitleProjectName.trim() || "字幕配音",
      });
      if (!target) {
        return;
      }
      const subtitleText = validateEditedSubtitleSrt(editedSubtitleSrtText);
      const formData = new FormData();
      formData.append("file", subtitleFile, subtitleFile.name || "subtitle.srt");
      formData.append("subtitle_text", subtitleText);
      formData.append("project_name", target.createNew ? (target.projectName || subtitleProjectName.trim()) : "");
      if (!target.createNew && target.projectId) {
        formData.append("target_project_id", target.projectId);
      }
      formData.append("mode", subtitleMode);
      formData.append("target_language", translationTargetLanguage);
      formData.append("translation_source", translationSource);
      formData.append("line_policy", subtitleLinePolicy);
      if (subtitleMode === "translated" && Array.isArray(subtitlePreview?.translated_segments)) {
        formData.append("translated_segments", JSON.stringify(subtitlePreview.translated_segments));
      }
      const response = await fetch(`${API_BASE_URL}/subtitles/create-dubbing-project`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      const projectId = String(payload?.project_id || "");
      if (!projectId) {
        throw new Error("后端未返回项目 ID。");
      }
      await selectProject(projectId, { suppressToast: true });
      await loadProjectScript(projectId);
      await loadProjects();
      setSubtitlePreview((current) => ({
        ...(current || {}),
        warnings: payload?.warnings || current?.warnings || [],
        segment_count: payload?.segment_count || current?.segment_count || 0,
        format: payload?.format || current?.format || "",
        speakers: payload?.speakers || current?.speakers || [],
      }));
      useUiStore.getState().pushToast({
        title: target.createNew
          ? `已创建字幕配音项目：${payload?.project?.name || target.projectName || subtitleProjectName || "字幕配音"}`
          : `已更新当前项目：${payload?.project?.name || target.projectName || "当前项目"}`,
        tone: "success",
      });
      onNavigate?.("script");
    } catch (err) {
      const message = err?.message || "创建字幕配音项目失败";
      setSubtitleError(message);
      useUiStore.getState().pushToast({ title: `创建失败：${message}`, tone: "error" });
    } finally {
      setIsCreatingSubtitleProject(false);
    }
  }

  async function handleTranslateSubtitle() {
    if (!subtitleFile) {
      setSubtitleError("请先上传 SRT 或 ASS 字幕。");
      return;
    }
    if (!isTranslationEngineLoaded || translationEngineStatus?.source !== translationSource) {
      setSubtitleError("请先按当前来源加载翻译引擎。");
      return;
    }
    setIsTranslatingSubtitle(true);
    setSubtitleError("");
    setSubtitleTask({ taskId: "", status: "queued", stageLabel: "字幕翻译任务排队中", processed: 0, total: 0, percent: 0, cacheHits: 0 });
    try {
      const subtitleText = validateEditedSubtitleSrt(editedSubtitleSrtText);
      const formData = new FormData();
      formData.append("file", subtitleFile, subtitleFile.name || "subtitle.srt");
      formData.append("subtitle_text", subtitleText);
      formData.append("target_language", translationTargetLanguage);
      formData.append("translation_source", translationSource);
      formData.append("line_policy", subtitleLinePolicy);
      formData.append("max_concurrency", ["openai", "gemini"].includes(translationSource) ? "4" : "1");
      const response = await fetch(`${API_BASE_URL}/subtitles/translate-preview/task`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const queued = await response.json();
      const taskId = String(queued?.task_id || "");
      if (!taskId) {
        throw new Error("字幕翻译任务未返回 task_id。");
      }
      subtitleTaskIdRef.current = taskId;
      setSubtitleTask((current) => ({ ...current, taskId, status: "queued" }));
      const payload = await runTaskChannel({
        wsUrl: `${getWsBaseUrl()}/ws/llm-stream/${taskId}`,
        timeoutMs: 40 * 60 * 1000,
        maxReconnectRetries: 5,
        baseDelayMs: 1000,
        shouldReconnect: () => Boolean(subtitleTaskIdRef.current),
        onConnectionStatus: () => {},
        onOpen: async () => {},
        syncTaskState: async ({ done, fail }) => {
          try {
            const stateResp = await fetch(`${API_BASE_URL}/subtitles/translate-preview/task/${taskId}`);
            if (!stateResp.ok) return false;
            const body = await stateResp.json();
            setSubtitleTask((current) => ({
              ...current,
              status: String(body?.status || current.status || ""),
              stageLabel: String(body?.stage_label || current.stageLabel || ""),
              percent: Number(body?.stage_progress || current.percent || 0),
            }));
            if (body?.status === "done" && body?.result) {
              done(body.result);
              return true;
            }
            if (body?.status === "error") {
              fail(new Error(String(body?.error || "字幕翻译任务失败")));
              return true;
            }
            if (body?.status === "canceled") {
              fail(new Error("字幕翻译任务已取消"));
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        onMessage: ({ msg, done, fail }) => {
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "task_status") {
            setSubtitleTask((current) => ({ ...current, status: String(msg.status || current.status || "") }));
            return;
          }
          if (msg.type === "dubbing_stage" || msg.type === "dubbing_progress" || msg.type === "progress") {
            setSubtitleTask((current) => ({
              ...current,
              stageLabel: String(msg.stage_label || msg.stageLabel || current.stageLabel || ""),
              processed: Number(msg.processed ?? msg.current ?? current.processed ?? 0),
              total: Number(msg.total ?? current.total ?? 0),
              percent: Number(msg.percent ?? current.percent ?? 0),
              cacheHits: Number(msg.cache_hits ?? current.cacheHits ?? 0),
            }));
            return;
          }
          if (msg.type === "cancel_requested") {
            setSubtitleTask((current) => ({ ...current, status: "cancel_requested", stageLabel: String(msg.message || "正在取消字幕翻译任务...") }));
            return;
          }
          if (msg.type === "canceled") {
            fail(new Error(String(msg.message || "字幕翻译任务已取消")));
            return;
          }
          if (msg.type === "complete") {
            done(msg.data || null);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(String(msg.message || "字幕翻译任务失败")));
          }
        },
      });
      setSubtitleMode("translated");
      setSubtitlePreview(payload);
      setSubtitleTask((current) => ({ ...current, status: "done", stageLabel: "字幕翻译完成", percent: 100 }));
      useUiStore.getState().pushToast({ title: "字幕翻译完成", tone: "success" });
    } catch (err) {
      const message = err?.message || "字幕翻译失败";
      setSubtitleError(message);
      const canceled = /取消|canceled/i.test(message);
      setSubtitleTask((current) => ({ ...current, status: canceled ? "canceled" : "error", stageLabel: canceled ? "字幕翻译已取消" : "字幕翻译失败" }));
      useUiStore.getState().pushToast({ title: canceled ? "已终止字幕翻译" : `字幕翻译失败：${message}`, tone: canceled ? "info" : "error" });
    } finally {
      subtitleTranslateAbortRef.current = null;
      subtitleTaskIdRef.current = "";
      setIsTranslatingSubtitle(false);
    }
  }

  async function handleAbortSubtitleTranslate() {
    if (!isTranslatingSubtitle || !subtitleTaskIdRef.current) return;
    try {
      await fetch(`${API_BASE_URL}/subtitles/translate-preview/task/${subtitleTaskIdRef.current}/cancel`, {
        method: "POST",
      });
      setSubtitleTask((current) => ({ ...current, status: "cancel_requested", stageLabel: "正在取消字幕翻译任务..." }));
    } catch {
      setSubtitleTask((current) => ({ ...current, stageLabel: "取消请求发送失败，请稍后重试。" }));
    }
  }

  async function waitForParseTask(parseTaskId) {
    const taskId = String(parseTaskId || "").trim();
    if (!taskId) {
      return null;
    }

    const syncParseState = async ({ done, fail }) => {
      try {
        const response = await fetch(`${API_BASE_URL}/llm/parse/${taskId}`);
        if (response.status === 202) {
          const body = await response.json().catch(() => ({}));
          setProjectTask((prev) => ({
            ...prev,
            status: body?.stage_label || body?.status || prev.status || "parse_running",
            parseTaskId: taskId,
          }));
          return false;
        }
        if (response.status >= 400) {
          const message = await readErrorMessage(response, `HTTP ${response.status}`);
          fail(new Error(message || "自动解析失败"));
          return true;
        }
        const script = await response.json();
        done(script);
        return true;
      } catch {
        return false;
      }
    };

    return await runTaskChannel({
      wsUrl: `${getWsBaseUrl()}/ws/llm-stream/${taskId}`,
      timeoutMs: 20 * 60 * 1000,
      maxTimeoutExtensions: 12,
      maxReconnectRetries: 5,
      baseDelayMs: 1000,
      shouldReconnect: () => true,
      onConnectionStatus: () => {},
      onOpen: async () => {},
      syncTaskState: syncParseState,
      onMessage: ({ msg, done, fail }) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "complete") {
          done(msg.data || null);
          return;
        }
        if (msg.type === "error") {
          fail(new Error(String(msg.message || "自动解析失败")));
          return;
        }
        if (msg.type === "canceled") {
          fail(new Error(String(msg.message || "自动解析已取消")));
          return;
        }
        if (msg.type === "parse_stage") {
          setProjectTask((prev) => ({
            ...prev,
            status: String(msg.stage_label || msg.stage || prev.status || "parse_running"),
            parseTaskId: taskId,
          }));
          return;
        }
        if (msg.type === "progress") {
          setProjectTask((prev) => ({
            ...prev,
            status: `解析中 ${Number(msg.percent || 0)}%`,
            parseTaskId: taskId,
          }));
          return;
        }
        if (msg.type === "task_status") {
          setProjectTask((prev) => ({
            ...prev,
            status: msg.status === "done" ? "解析完成" : String(msg.status || prev.status || "parse_running"),
            parseTaskId: taskId,
          }));
        }
      },
    });
  }

  async function refreshTranslationStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/llm/translation-engine/status`);
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      setTranslationEngineStatus(payload);
    } catch (err) {
      setTranslationEngineStatus({
        loaded: false,
        source: "",
        backend: "unavailable",
        model_name: "",
        error: err?.message || "获取翻译引擎状态失败",
      });
    }
  }

  useEffect(() => {
    if (!projects.length) {
      loadProjects().catch(() => undefined);
    }
  }, [loadProjects, projects.length]);

  useEffect(() => {
    refreshSystemStatus().catch(() => undefined);
  }, [refreshSystemStatus]);

  useEffect(() => {
    setRenameProjectName(currentProject?.name || "");
  }, [currentProject?.id, currentProject?.name]);

  useEffect(() => {
    refreshTranslationStatus();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (translateAbortRef.current) {
        translateAbortRef.current.abort();
        translateAbortRef.current = null;
      }
      if (subtitleTranslateAbortRef.current) {
        subtitleTranslateAbortRef.current.abort();
        subtitleTranslateAbortRef.current = null;
      }
      subtitleTaskIdRef.current = "";
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pendingAudio?.url) {
        URL.revokeObjectURL(pendingAudio.url);
      }
    };
  }, [pendingAudio?.url]);

  async function transcribeBlob(blob, fileName = "recording.webm") {
    setIsTranscribing(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("backend", asrBackendConfigured || "whisper");
      formData.append("language", asrLanguage || "auto");
      formData.append("speaker_labels", String(!isQwen3Backend && Boolean(speakerLabels)));
      formData.append("enable_timestamps", String(Boolean(effectiveAsrEnableTimestamps)));
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`${API_BASE_URL}/asr/transcribe-file`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      const nextPlainText = String(payload?.text || "").trim();
      const nextLabeledText = String(payload?.labeled_text || "").trim();
      const nextAlignments = Array.isArray(payload?.alignments) ? payload.alignments : [];
      const mapped = payload?.speaker_map && typeof payload.speaker_map === "object" ? payload.speaker_map : {};
      const fallbackSpeakerMap = {};
      nextAlignments.forEach((item) => {
        const speaker = String(item?.speaker || "").trim();
        if (speaker && !fallbackSpeakerMap[speaker]) {
          fallbackSpeakerMap[speaker] = speaker;
        }
      });
      const nextSpeakerMap = Object.keys(mapped).length ? mapped : fallbackSpeakerMap;
      setPlainText(nextPlainText);
      setTranscript(nextLabeledText || nextPlainText);
      setAlignments(nextAlignments);
      setSpeakerMap(nextSpeakerMap);
      setWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
      setBackendUsed(String(payload?.backend || "whisper"));
      setModelFiles(payload?.model_files || null);
      setProjectTask({ status: "", failedChunks: [], warnings: [], chunkProgress: null, parseTaskId: "" });
      if (!nextPlainText && !nextLabeledText) {
        setError("识别结果为空，请重试。");
      } else {
        useUiStore.getState().pushToast({ title: "语音识别完成", tone: "success" });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("已终止识别。");
        useUiStore.getState().pushToast({ title: "已终止识别", tone: "warning" });
        return;
      }
      const message = err?.message || "识别失败";
      setError(message);
      useUiStore.getState().pushToast({ title: `语音识别失败：${message}`, tone: "error" });
    } finally {
      abortRef.current = null;
      setIsTranscribing(false);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    setPendingAudio((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return { blob: file, fileName: file.name || "upload.wav", url: nextUrl };
    });
    setProjectTask({ status: "", failedChunks: [], warnings: [], chunkProgress: null, parseTaskId: "" });
    setError("");
  }

  async function handleStartRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持录音。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        const nextUrl = URL.createObjectURL(blob);
        setPendingAudio((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return { blob, fileName: "recording.webm", url: nextUrl };
        });
        setProjectTask({ status: "", failedChunks: [], warnings: [], chunkProgress: null, parseTaskId: "" });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      const message = err?.message || "录音权限被拒绝";
      setError(message);
      useUiStore.getState().pushToast({ title: `录音失败：${message}`, tone: "error" });
    }
  }

  function handleStopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      return;
    }
    recorder.stop();
    setIsRecording(false);
  }

  async function handleRecognize() {
    if (!pendingAudio?.blob) {
      setError("请先上传或录制音频。");
      return;
    }
    await transcribeBlob(pendingAudio.blob, pendingAudio.fileName || "audio.wav");
  }

  function handleAbortRecognize() {
    if (!isTranscribing || !abortRef.current) {
      return;
    }
    abortRef.current.abort();
  }

  async function handleUnloadAsr() {
    try {
      const response = await fetch(`${API_BASE_URL}/system/unload-asr`, { method: "POST" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      setBackendUsed("");
      setModelFiles(null);
      refreshSystemStatus().catch(() => undefined);
      useUiStore.getState().pushToast({ title: "ASR 已卸载", tone: "success" });
    } catch (err) {
      const message = err?.message || "卸载 ASR 失败";
      setError(message);
      useUiStore.getState().pushToast({ title: message, tone: "error" });
    }
  }

  async function handleLoadTranslationEngine() {
    setIsLoadingTranslationEngine(true);
    setTranslationError("");
    try {
      const response = await fetch(`${API_BASE_URL}/llm/translation-engine/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: translationSource }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      setTranslationEngineStatus({
        loaded: true,
        source: payload?.source || translationSource,
        backend: payload?.backend || "unknown",
        model_name: payload?.model_name || "",
        error: payload?.error || "",
      });
      useUiStore.getState().pushToast({ title: "翻译引擎已加载", tone: "success" });
    } catch (err) {
      const message = err?.message || "加载翻译引擎失败";
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: `加载失败：${message}`, tone: "error" });
      await refreshTranslationStatus();
    } finally {
      setIsLoadingTranslationEngine(false);
    }
  }

  async function handleUnloadTranslationEngine() {
    setIsLoadingTranslationEngine(true);
    try {
      const response = await fetch(`${API_BASE_URL}/llm/translation-engine/unload`, { method: "POST" });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      setTranslationEngineStatus({
        loaded: false,
        source: "",
        backend: "unloaded",
        model_name: "",
        error: "",
      });
      useUiStore.getState().pushToast({ title: "翻译引擎已卸载", tone: "success" });
    } catch (err) {
      const message = err?.message || "卸载翻译引擎失败";
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: `卸载失败：${message}`, tone: "error" });
      await refreshTranslationStatus();
    } finally {
      setIsLoadingTranslationEngine(false);
    }
  }

  async function handleTranslatePolish() {
    if (translationMode !== "passthrough" && !isTranslationEngineLoaded) {
      setTranslationError("请先加载翻译引擎。");
      return;
    }
    const input = (translationPlainInputText || "").trim();
    if (!input) {
      setTranslationError("请先完成语音识别，或在识别预览中输入文本。");
      return;
    }
    setIsTranslating(true);
    setTranslationError("");
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      if (translationMode === "passthrough") {
        setTranslationResult(input);
        useUiStore.getState().pushToast({ title: "已直通复制识别文本", tone: "success" });
        return;
      }
      const response = await fetch(`${API_BASE_URL}/llm/translate-polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text: input,
          mode: translationMode,
          target_language: translationTargetLanguage,
          source: translationSource,
        }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const payload = await response.json();
      setTranslationResult(String(payload?.text || "").trim());
      await refreshTranslationStatus();
      useUiStore.getState().pushToast({ title: "翻译润色完成", tone: "success" });
    } catch (err) {
      if (err?.name === "AbortError") {
        setTranslationError("已终止翻译润色。");
        return;
      }
      const message = err?.message || "翻译润色失败";
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: `翻译润色失败：${message}`, tone: "error" });
    } finally {
      translateAbortRef.current = null;
      setIsTranslating(false);
    }
  }

  async function handleAbortTranslate() {
    if (isBuildingDubbingProject && dubbingTaskIdRef.current) {
      try {
        await fetch(`${API_BASE_URL}/llm/translate-dubbing-segments/task/${dubbingTaskIdRef.current}/cancel`, {
          method: "POST",
        });
        setDubbingTask((current) => ({ ...current, status: "cancel_requested", stageLabel: "正在取消翻译配音任务..." }));
      } catch {
        setDubbingTask((current) => ({ ...current, stageLabel: "取消请求发送失败，请稍后重试。" }));
      }
      return;
    }
    if (!isTranslating || !translateAbortRef.current) return;
    translateAbortRef.current.abort();
  }

  async function handleCreateDubbingProject() {
    if (translationMode !== "passthrough" && !isTranslationEngineLoaded) {
      setTranslationError("请先加载翻译引擎。");
      return;
    }
    if (isQwen3Backend) {
      setTranslationError("Qwen3-ASR (CrispASR) 当前不提供可用时间轴，无法创建时间轴匹配配音项目。");
      return;
    }
    let normalizedAlignments = [];
    try {
      normalizedAlignments = parseEditedPreviewDubbingSegments();
    } catch (err) {
      setTranslationError(err?.message || "识别预览格式不符合翻译配音要求。");
      return;
    }
    setIsBuildingDubbingProject(true);
    setTranslationError("");
    const taskLabel = getDubbingTaskLabel(translationMode);
    setDubbingTask({ taskId: "", status: "queued", stageLabel: taskLabel, processed: 0, total: normalizedAlignments.length, percent: 0, cacheHits: 0 });
    try {
      const response = await fetch(`${API_BASE_URL}/llm/translate-dubbing-segments/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: translationSource,
          mode: translationMode,
          target_language: translationTargetLanguage,
          min_speed: 0.8,
          max_speed: 1.2,
          max_concurrency: ["openai", "gemini"].includes(translationSource) ? 4 : 1,
          segments: normalizedAlignments,
        }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const queued = await response.json();
      const taskId = String(queued?.task_id || "");
      if (!taskId) {
        throw new Error("翻译配音任务未返回 task_id。");
      }
      dubbingTaskIdRef.current = taskId;
      setDubbingTask((current) => ({ ...current, taskId, status: "queued" }));

      const payload = await runTaskChannel({
        wsUrl: `${getWsBaseUrl()}/ws/llm-stream/${taskId}`,
        timeoutMs: 40 * 60 * 1000,
        maxReconnectRetries: 5,
        baseDelayMs: 1000,
        shouldReconnect: () => Boolean(dubbingTaskIdRef.current),
        onConnectionStatus: () => {},
        onOpen: async () => {},
        syncTaskState: async ({ done, fail }) => {
          try {
            const stateResp = await fetch(`${API_BASE_URL}/llm/translate-dubbing-segments/task/${taskId}`);
            if (!stateResp.ok) return false;
            const body = await stateResp.json();
            setDubbingTask((current) => ({
              ...current,
              status: String(body?.status || current.status || ""),
              stageLabel: String(body?.stage_label || current.stageLabel || ""),
              percent: Number(body?.stage_progress || current.percent || 0),
            }));
            if (body?.status === "done" && body?.result) {
              done(body.result);
              return true;
            }
            if (body?.status === "error") {
              fail(new Error(String(body?.error || "翻译配音任务失败")));
              return true;
            }
            if (body?.status === "canceled") {
              fail(new Error("翻译配音任务已取消"));
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        onMessage: ({ msg, done, fail }) => {
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "task_status") {
            setDubbingTask((current) => ({ ...current, status: String(msg.status || current.status || "") }));
            return;
          }
          if (msg.type === "dubbing_stage" || msg.type === "dubbing_progress" || msg.type === "progress") {
            setDubbingTask((current) => ({
              ...current,
              stageLabel: String(msg.stage_label || msg.stageLabel || current.stageLabel || ""),
              processed: Number(msg.processed ?? msg.current ?? current.processed ?? 0),
              total: Number(msg.total ?? current.total ?? normalizedAlignments.length),
              percent: Number(msg.percent ?? current.percent ?? 0),
              cacheHits: Number(msg.cache_hits ?? current.cacheHits ?? 0),
            }));
            return;
          }
          if (msg.type === "cancel_requested") {
            setDubbingTask((current) => ({ ...current, status: "cancel_requested", stageLabel: String(msg.message || "正在取消翻译配音任务...") }));
            return;
          }
          if (msg.type === "canceled") {
            fail(new Error(String(msg.message || "翻译配音任务已取消")));
            return;
          }
          if (msg.type === "complete") {
            done(msg.data || null);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(String(msg.message || "翻译配音任务失败")));
          }
        },
      });
      const translatedSegments = Array.isArray(payload?.segments) ? payload.segments : [];
      if (!translatedSegments.length) {
        throw new Error("未返回可用分段翻译结果。");
      }

      const nextProjectName = buildDubbingProjectName({
        projectName,
        audioFileName: pendingAudio?.fileName,
        mode: translationMode,
      });
      const target = await requestDubbingProjectTarget({
        kindLabel: "生成翻译配音项目",
        defaultName: nextProjectName,
      });
      if (!target) {
        throw new Error("翻译配音项目创建已取消");
      }
      const finalProjectName = target.projectName || nextProjectName;
      const project = target.createNew ? await createProject(finalProjectName) : currentProject;
      if (!project?.id) {
        throw new Error("没有可用项目。");
      }

      const scriptPayload = buildTranslatedDubbingScriptPayload({
        payload,
        title: target.createNew ? finalProjectName : (target.projectName || project.name || nextProjectName),
        translationMode,
        translationSource,
        translationTargetLanguage,
        translatedSegments,
      });

      await saveScript({
        projectId: project.id,
        script: scriptPayload,
      });
      try {
        if (pendingAudio?.blob) {
          const sourceAudioForm = new FormData();
          sourceAudioForm.append("file", pendingAudio.blob, pendingAudio.fileName || "audio.wav");
          const sourceAudioResponse = await fetch(`${API_BASE_URL}/projects/${project.id}/source-audio`, {
            method: "POST",
            body: sourceAudioForm,
          });
          if (!sourceAudioResponse.ok) {
            const message = await readErrorMessage(sourceAudioResponse, `HTTP ${sourceAudioResponse.status}`);
            throw new Error(message);
          }
        }
      } catch (sourceAudioError) {
        useUiStore.getState().pushToast({
          title: `原音频保存失败：${sourceAudioError?.message || sourceAudioError}`,
          tone: "warning",
        });
      }
      await selectProject(project.id, { suppressToast: true });
      await loadProjectScript(project.id);
      setTranslationResult(String(payload?.translated_text || "").trim());
      setDubbingTask((current) => ({ ...current, status: "done", stageLabel: "翻译配音完成", percent: 100 }));
      useUiStore.getState().pushToast({
        title: target.createNew ? `已创建翻译配音项目：${finalProjectName}` : `已更新当前项目：${project.name}`,
        tone: "success",
      });
      onNavigate?.("script");
    } catch (err) {
      const message = err?.message || "创建翻译配音项目失败";
      setTranslationError(message);
      const canceled = /取消|canceled/i.test(message);
      setDubbingTask((current) => ({ ...current, status: canceled ? "canceled" : "error", stageLabel: message }));
      useUiStore.getState().pushToast({ title: canceled ? "翻译配音任务已取消" : `创建失败：${message}`, tone: canceled ? "default" : "error" });
    } finally {
      dubbingTaskIdRef.current = "";
      setIsBuildingDubbingProject(false);
    }
  }

  async function handleCreateProjectFromAudio() {
    if (!pendingAudio?.blob) {
      setError("请先上传或录制音频。");
      return;
    }
    setIsCreatingProject(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", pendingAudio.blob, pendingAudio.fileName || "audio.wav");
      formData.append("project_name", projectName.trim());
      formData.append("speaker_labels", String(!isQwen3Backend && Boolean(speakerLabels)));
      formData.append("backend", asrBackendConfigured || "whisper");
      formData.append("language", asrLanguage || "auto");
      formData.append("enable_timestamps", String(Boolean(effectiveAsrEnableTimestamps)));
      formData.append("parse_mode", "verified_five_step_pipeline");
      formData.append("auto_parse", "true");
      formData.append("speaker_map", JSON.stringify(speakerMap || {}));
      const response = await fetch(`${API_BASE_URL}/asr/project-from-audio`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const queued = await response.json();
      const taskId = String(queued?.task_id || "");
      if (!taskId) {
        throw new Error("创建任务成功，但未返回任务 ID。");
      }
      setProjectTask({
        status: "queued",
        failedChunks: [],
        warnings: [],
        chunkProgress: { completed: 0, total: 0 },
        parseTaskId: "",
      });

      const result = await runTaskChannel({
        wsUrl: `${getWsBaseUrl()}/ws/asr-progress/${taskId}`,
        timeoutMs: 40 * 60 * 1000,
        maxReconnectRetries: 5,
        baseDelayMs: 1000,
        shouldReconnect: () => true,
        onConnectionStatus: () => {},
        onOpen: async () => {},
        syncTaskState: async ({ done, fail }) => {
          try {
            const stateResp = await fetch(`${API_BASE_URL}/asr/project-from-audio/${taskId}`);
            if (!stateResp.ok) return false;
            const body = await stateResp.json();
            if (body?.status === "done" && body?.result) {
              done(body.result);
              return true;
            }
            if (body?.status === "error") {
              fail(new Error(String(body?.error || "ASR 任务失败")));
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        onMessage: ({ msg, done, fail }) => {
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "task_status") {
            setProjectTask((prev) => ({ ...prev, status: String(msg.status || prev.status || "running") }));
            return;
          }
          if (msg.type === "chunk_total") {
            setProjectTask((prev) => ({
              ...prev,
              chunkProgress: { completed: Number(prev?.chunkProgress?.completed || 0), total: Number(msg.total || 0) },
            }));
            return;
          }
          if (msg.type === "chunk_progress") {
            setProjectTask((prev) => ({
              ...prev,
              status: "running",
              chunkProgress: { completed: Number(msg.completed || 0), total: Number(msg.total_chunks || 0) },
            }));
            return;
          }
          if (msg.type === "warning") {
            setProjectTask((prev) => ({
              ...prev,
              warnings: [...(prev?.warnings || []), String(msg.message || "")].filter(Boolean),
            }));
            return;
          }
          if (msg.type === "chunk_failed") {
            setProjectTask((prev) => ({
              ...prev,
              failedChunks: [...(prev?.failedChunks || []), msg.chunk].filter(Boolean),
              chunkProgress: { completed: Number(msg.completed || 0), total: Number(msg.total_chunks || 0) },
            }));
            return;
          }
          if (msg.type === "parse_queued") {
            setProjectTask((prev) => ({ ...prev, parseTaskId: String(msg.parse_task_id || "") }));
            return;
          }
          if (msg.type === "complete") {
            done(msg.data || null);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(String(msg.message || "ASR 任务失败")));
          }
        },
      });

      const payload = result || {};
      const nextProjectId = String(payload?.project_id || "");
      const nextStatus = String(payload?.status || "asr_done");
      const nextFailed = Array.isArray(payload?.failed_chunks) ? payload.failed_chunks : [];
      const nextWarnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
      const nextChunkProgress = payload?.chunk_progress || null;
      const nextParseTaskId = String(payload?.parse_task_id || "");
      setProjectTask({
        status: nextStatus,
        failedChunks: nextFailed,
        warnings: nextWarnings,
        chunkProgress: nextChunkProgress,
        parseTaskId: nextParseTaskId,
      });

      if (!nextProjectId) {
        throw new Error("创建项目成功，但未返回项目 ID。");
      }

      await selectProject(nextProjectId, { suppressToast: true });
      await loadProjectScript(nextProjectId);

      let issueCount = 0;
      if (nextParseTaskId) {
        setProjectTask((prev) => ({ ...prev, status: "等待自动解析完成", parseTaskId: nextParseTaskId }));
        await waitForParseTask(nextParseTaskId);
        await loadProjectScript(nextProjectId);
        try {
          const report = await loadProjectParseQc(nextProjectId);
          issueCount = Number(report?.summary?.issue_count || 0);
        } catch {
          issueCount = 0;
        }
      } else {
        await loadProjectScript(nextProjectId);
      }

      useUiStore.getState().pushToast({
        title: nextFailed.length ? `项目已创建（${nextFailed.length} 个分块失败）` : "项目创建完成",
        tone: nextFailed.length ? "warning" : "success",
      });
      onNavigate?.(issueCount > 0 ? "qc" : "script");
    } catch (err) {
      const message = err?.message || "一键转项目失败";
      setError(message);
      useUiStore.getState().pushToast({ title: `一键转项目失败：${message}`, tone: "error" });
    } finally {
      setIsCreatingProject(false);
    }
  }

  function handleAppendToText() {
    const toInsert = (previewText || "").trim();
    if (!toInsert) {
      return;
    }
    setSourceText(appendSpeechText(sourceText, toInsert));
    useUiStore.getState().pushToast({ title: "已追加到文本输入", tone: "success" });
    onNavigate?.("text");
  }

  function handleReplaceText() {
    const toInsert = (previewText || "").trim();
    if (!toInsert) {
      return;
    }
    setSourceText(replaceSpeechText(toInsert));
    useUiStore.getState().pushToast({ title: "已替换文本输入内容", tone: "success" });
    onNavigate?.("text");
  }

  function handleClearResult() {
    clearResult();
    setEditedPreviewText("");
    setProjectTask({ status: "", failedChunks: [], warnings: [], chunkProgress: null, parseTaskId: "" });
  }

  function handleAppendTranslationToText() {
    const toInsert = (translationResult || "").trim();
    if (!toInsert) return;
    setSourceText(appendSpeechText(sourceText, toInsert));
    useUiStore.getState().pushToast({ title: "翻译润色结果已追加到文本输入", tone: "success" });
    onNavigate?.("text");
  }

  function handleReplaceTranslationToText() {
    const toInsert = (translationResult || "").trim();
    if (!toInsert) return;
    setSourceText(replaceSpeechText(toInsert));
    useUiStore.getState().pushToast({ title: "翻译润色结果已替换文本输入", tone: "success" });
    onNavigate?.("text");
  }

  async function handleSelectProject(projectId) {
    if (!projectId) return;
    await selectProject(projectId);
    await loadProjectScript(projectId);
  }

  async function handleCreateProject() {
    const name = newProjectName.trim() || `项目 ${new Date().toLocaleTimeString("zh-CN")}`;
    const project = await createProject(name);
    setNewProjectName("");
    await loadProjectScript(project.id);
  }

  async function handleRenameProject() {
    if (!currentProject?.id) {
      return;
    }
    const nextName = renameProjectName.trim();
    if (!nextName) {
      useUiStore.getState().pushToast({ title: "项目名称不能为空", tone: "warning" });
      return;
    }
    if (nextName === currentProject.name) {
      useUiStore.getState().pushToast({ title: "项目名称未变化", tone: "default" });
      return;
    }
    try {
      await renameProject(currentProject.id, nextName);
      setRenameProjectName(nextName);
    } catch (renameError) {
      useUiStore.getState().pushToast({
        title: `项目改名失败：${renameError?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  async function handleDeleteProject() {
    if (!currentProject?.id) {
      return;
    }
    const ok = window.confirm(`确认删除项目「${currentProject.name}」？该操作不可撤销。`);
    if (!ok) return;
    try {
      await deleteProject(currentProject.id, { silent: true });
      useUiStore.getState().pushToast({ title: "项目已删除", tone: "success" });
      const nextProjects = useProjectStore.getState().projects || [];
      const next = nextProjects[0];
      if (next?.id) {
        await handleSelectProject(next.id);
      }
    } catch {
      useUiStore.getState().pushToast({ title: "项目删除失败，请重试", tone: "warning" });
    }
  }

  async function handleDeleteSameNameDuplicates() {
    if (!currentProject?.id) {
      return;
    }
    const siblingProjects = getSameNameSiblingProjects(projects, currentProject);
    if (!siblingProjects.length) {
      return;
    }
    const ok = window.confirm(
      `检测到 ${siblingProjects.length} 个与「${currentProject.name}」同名的副本。\n确认删除这些同名副本并保留当前项目？`
    );
    if (!ok) {
      return;
    }
    let deletedCount = 0;
    const failedIds = [];
    for (const project of siblingProjects) {
      try {
        await deleteProject(project.id, { silent: true });
        deletedCount += 1;
      } catch {
        failedIds.push(project.id);
      }
    }
    if (deletedCount > 0) {
      useUiStore.getState().pushToast({ title: `已删除 ${deletedCount} 个同名副本`, tone: "success" });
    }
    if (failedIds.length) {
      useUiStore.getState().pushToast({ title: `有 ${failedIds.length} 个同名副本删除失败，请重试`, tone: "warning" });
    }
  }

  async function handleImportArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await importArchive(file);
    const project = result?.project;
    if (!project?.id) return;
    await loadProjectScript(project.id);
  }

  async function importProjectFileAndSelect(file, options = {}) {
    if (!file) return;
    const result = await importProjectFile(file, options);
    const project = result?.project;
    if (!project?.id) return;
    await loadProjectScript(project.id);
  }

  async function handleOpenProjectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await importProjectFileAndSelect(file, { fileName: file?.name || "" });
  }

  async function handleOpenProjectFileClick() {
    try {
      const picked = await openProjectFileWithPicker();
      if (!picked?.file) {
        projectFileInputRef.current?.click();
        return;
      }
      await importProjectFileAndSelect(picked.file, { handle: picked.handle, fileName: picked.file.name });
    } catch (openError) {
      if (openError?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({
        title: `打开项目文件失败：${openError?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    if (!currentProject) {
      useUiStore.getState().pushToast({ title: "请先创建或选择项目", tone: "warning" });
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
    } catch (saveError) {
      if (saveError?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({
        title: `保存项目失败：${saveError?.message || "未知错误"}`,
        tone: "error",
      });
    }
  }, [currentProject, script, sourceText, currentProjectFileHandle, bindCurrentProjectFile]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  const moreMenuItems = useMemo(() => [
    {
      label: "删除当前项目",
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id,
      onSelect: handleDeleteProject,
    },
    { type: "separator" },
    {
      label: sameNameSiblingProjects.length ? `删除同名副本（${sameNameSiblingProjects.length}）` : "删除同名副本",
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id || sameNameSiblingProjects.length < 1,
      title: sameNameSiblingProjects.length
        ? `删除 ${sameNameSiblingProjects.length} 个与当前项目同名的副本`
        : "当前没有可删除的同名副本",
      onSelect: handleDeleteSameNameDuplicates,
    },
  ], [currentProject?.id, sameNameSiblingProjects.length, handleDeleteProject, handleDeleteSameNameDuplicates]);

  return (
    <div className="speechPageLayout">
      <div className="speechPageColumn">
        <SpeechProjectToolbarSection
          archiveInputRef={archiveInputRef}
          currentProject={currentProject}
          currentProjectMeta={currentProjectMeta}
          importWarnings={importWarnings}
          isProjectOpsBusy={isProjectOpsBusy}
          moreMenuItems={moreMenuItems}
          newProjectName={newProjectName}
          onCreateProject={handleCreateProject}
          onImportArchive={handleImportArchive}
          onOpenProjectFile={handleOpenProjectFile}
          onOpenProjectFileClick={handleOpenProjectFileClick}
          onProjectNameChange={setNewProjectName}
          onProjectNameKeyDown={(event) => event.key === "Enter" && handleCreateProject()}
          onRenameProject={handleRenameProject}
          onRenameProjectNameChange={setRenameProjectName}
          onRenameProjectNameKeyDown={(event) => event.key === "Enter" && handleRenameProject()}
          onSelectProject={handleSelectProject}
          projectFileInputRef={projectFileInputRef}
          projectOptions={projectOptions}
          renameProjectName={renameProjectName}
        />

        <AsrRecognitionCard
          asrBackendConfigured={asrBackendConfigured}
          asrLanguage={asrLanguage}
          asrLanguageOptions={asrLanguageOptions}
          asrUnavailableReason={asrUnavailableReason}
          backendUsed={backendUsed}
          error={error}
          isCreatingProject={isCreatingProject}
          isQwen3Backend={isQwen3Backend}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          modelFiles={modelFiles}
          onAbortRecognize={handleAbortRecognize}
          onAsrBackendChange={setAsrBackend}
          onAsrLanguageChange={setAsrLanguage}
          onRecognize={handleRecognize}
          onSpeakerLabelsChange={setSpeakerLabels}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onUnloadAsr={handleUnloadAsr}
          onUpload={handleUpload}
          pendingAudio={pendingAudio}
          projectTask={projectTask}
          showTimestampToggle={showTimestampToggle}
          speakerLabelHint={speakerLabelHint}
          speakerLabels={speakerLabels}
          warnings={warnings}
        />
      </div>

      <div className="speechPageColumn">
        <RecognitionPreviewCard
          alignments={remappedAlignments}
          canInsert={canInsert}
          isBusy={isTranscribing || isRecording || isCreatingProject}
          isQwen3Backend={isQwen3Backend}
          onAppendToText={handleAppendToText}
          onClearResult={handleClearResult}
          onPreviewTextChange={setEditedPreviewText}
          onReplaceText={handleReplaceText}
          onShowTimelineChange={setShowTimeline}
          onSpeakerMapEntryChange={updateSpeakerMapEntry}
          plainText={plainText}
          previewText={previewText}
          showTimeline={showTimeline}
          speakerLabels={speakerLabels}
          speakerMap={speakerMap}
          transcript={transcript}
        />

        <SpeechUtilityTabs
          canBuildDubbingProject={canBuildDubbingProject}
          canCreateSubtitleProject={canCreateSubtitleProject}
          canInsertTranslation={canInsertTranslation}
          clearTranslationResult={clearTranslationResult}
          dubbingTask={dubbingTask}
          editedSubtitleSrtText={editedSubtitleSrtText}
          isBuildingDubbingProject={isBuildingDubbingProject}
          isCreatingProject={isCreatingProject}
          isCreatingSubtitleProject={isCreatingSubtitleProject}
          isLoadingTranslationEngine={isLoadingTranslationEngine}
          isPreviewingSubtitle={isPreviewingSubtitle}
          isQwen3Backend={isQwen3Backend}
          isTranslating={isTranslating}
          isTranslatingSubtitle={isTranslatingSubtitle}
          isTranslationEngineLoaded={isTranslationEngineLoaded}
          onAbortSubtitleTranslate={handleAbortSubtitleTranslate}
          onAbortTranslate={handleAbortTranslate}
          onAppendTranslationToText={handleAppendTranslationToText}
          onCreateDubbingProject={handleCreateDubbingProject}
          onCreateSubtitleDubbingProject={handleCreateSubtitleDubbingProject}
          onLoadTranslationEngine={handleLoadTranslationEngine}
          onPreviewSubtitleFile={previewSubtitleFile}
          onReplaceTranslationToText={handleReplaceTranslationToText}
          onSubtitleFileChange={handleSubtitleFileChange}
          onSubtitleLinePolicyChange={handleSubtitleLinePolicyChange}
          onSubtitleModeChange={handleSubtitleModeChange}
          onSubtitleProjectNameChange={setSubtitleProjectName}
          onTranslatePolish={handleTranslatePolish}
          onTranslateSubtitle={handleTranslateSubtitle}
          onUnloadTranslationEngine={handleUnloadTranslationEngine}
          onUtilityTabChange={setUtilityTab}
          setEditedSubtitleSrtText={setEditedSubtitleSrtText}
          setSubtitlePreview={setSubtitlePreview}
          setTranslationMode={setTranslationMode}
          setTranslationResult={setTranslationResult}
          setTranslationSource={setTranslationSource}
          setTranslationTargetLanguage={setTranslationTargetLanguage}
          subtitleCreateDisabledReason={subtitleCreateDisabledReason}
          subtitleError={subtitleError}
          subtitleFile={subtitleFile}
          subtitleLinePolicy={subtitleLinePolicy}
          subtitleMode={subtitleMode}
          subtitlePreview={subtitlePreview}
          subtitleProjectName={subtitleProjectName}
          subtitleTask={subtitleTask}
          translationEngineStatus={translationEngineStatus}
          translationError={translationError}
          translationMode={translationMode}
          translationResult={translationResult}
          translationSource={translationSource}
          translationTargetLanguage={translationTargetLanguage}
          utilityTab={utilityTab}
        />
      </div>
      <DubbingProjectTargetDialog
        open={dubbingProjectDialog.open}
        kindLabel={dubbingProjectDialog.kindLabel}
        defaultName={dubbingProjectDialog.defaultName}
        currentProject={currentProject}
        onCancel={() => resolveDubbingProjectTarget(null)}
        onUseCurrent={() => {
          useUiStore.getState().pushToast({
            title: `将继续使用当前项目：${currentProject?.name || "当前项目"}`,
            tone: "warning",
          });
          resolveDubbingProjectTarget({
            createNew: false,
            projectId: currentProject?.id || "",
            projectName: currentProject?.name || "",
          });
        }}
        onCreateNew={(projectName) => resolveDubbingProjectTarget({
          createNew: true,
          projectId: "",
          projectName,
        })}
      />
    </div>
  );
}
