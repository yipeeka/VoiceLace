import { FolderPlus, Languages, Mic, Square, Trash2, Upload, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import ProjectToolbarCard from "../components/text/ProjectToolbarCard";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSpeechRecognitionStore } from "../stores/useSpeechRecognitionStore";
import { useUiStore } from "../stores/useUiStore";
import { API_BASE_URL, getWsBaseUrl } from "../utils/api";
import { openProjectFileWithPicker } from "../utils/projectFile";
import {
  buildProjectOption,
  getProjectSourceTag,
  getSameNameSiblingProjects,
  shortProjectId,
  toProjectFileDisplayName,
} from "../utils/projectToolbar";
import { runTaskChannel } from "../utils/taskChannel";
import { appendSpeechText, replaceSpeechText } from "../utils/speechText";

export default function SpeechRecognitionPage({ onNavigate }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
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
  const translationResult = useSpeechRecognitionStore((state) => state.translationResult);
  const setTranslationResult = useSpeechRecognitionStore((state) => state.setTranslationResult);
  const translationError = useSpeechRecognitionStore((state) => state.translationError);
  const setTranslationError = useSpeechRecognitionStore((state) => state.setTranslationError);
  const translationEngineStatus = useSpeechRecognitionStore((state) => state.translationEngineStatus);
  const setTranslationEngineStatus = useSpeechRecognitionStore((state) => state.setTranslationEngineStatus);
  const clearTranslationResult = useSpeechRecognitionStore((state) => state.clearTranslationResult);
  const clearResult = useSpeechRecognitionStore((state) => state.clearResult);
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentProjectFileName = useProjectStore((state) => state.currentProjectFileName);
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
  const loadProjectParseQc = useProjectStore((state) => state.loadProjectParseQc);
  const sourceText = useScriptStore((state) => state.sourceText);
  const setSourceText = useScriptStore((state) => state.setSourceText);
  const [isLoadingTranslationEngine, setIsLoadingTranslationEngine] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const isTranslationEngineLoaded = Boolean(translationEngineStatus?.loaded);
  const isProjectOpsBusy = isTranscribing || isRecording || isCreatingProject;

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

  const previewText = speakerLabels ? mappedTranscript : plainText;
  const canInsert = useMemo(() => Boolean((previewText || "").trim()), [previewText]);
  const canInsertTranslation = useMemo(() => Boolean((translationResult || "").trim()), [translationResult]);

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
      formData.append("backend", "whisper");
      formData.append("speaker_labels", String(Boolean(speakerLabels)));
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
    if (!isTranslationEngineLoaded) {
      setTranslationError("请先加载翻译引擎。");
      return;
    }
    const input = (previewText || "").trim();
    if (!input) {
      setTranslationError("请先完成语音识别，或在识别预览中输入文本。");
      return;
    }
    setIsTranslating(true);
    setTranslationError("");
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
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

  function handleAbortTranslate() {
    if (!isTranslating || !translateAbortRef.current) return;
    translateAbortRef.current.abort();
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
      formData.append("speaker_labels", String(Boolean(speakerLabels)));
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
        <GlassCard>
        <ProjectToolbarCard
          currentProject={currentProject}
          currentProjectMeta={currentProjectMeta}
          projectOptions={projectOptions}
          projectName={newProjectName}
          renameProjectName={renameProjectName}
          isParsing={isProjectOpsBusy}
          archiveInputRef={archiveInputRef}
          projectFileInputRef={projectFileInputRef}
          onProjectNameChange={setNewProjectName}
          onProjectNameKeyDown={(event) => event.key === "Enter" && handleCreateProject()}
          onRenameProjectNameChange={setRenameProjectName}
          onRenameProjectNameKeyDown={(event) => event.key === "Enter" && handleRenameProject()}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onOpenProjectFileClick={handleOpenProjectFileClick}
          onProjectFileInputChange={handleOpenProjectFile}
          onImportArchive={handleImportArchive}
          moreMenuItems={moreMenuItems}
        />
        {importWarnings?.length ? (
          <div className="statusBadge warning" style={{ marginTop: 2, display: "block", textAlign: "left" }}>
            {importWarnings.map((warning, idx) => (
              <div key={`${idx}-${warning}`}>导入提示 {idx + 1}: {warning}</div>
            ))}
          </div>
        ) : null}
        </GlassCard>

        <GlassCard>
        <h2 className="cardTitle">
          <Mic size={16} />
          语音识别
        </h2>
        <p className="cardSubtitle">支持录音与上传音频，识别结果可直接接入文本输入。</p>

        <div className="muted">ASR 后端：Whisper</div>

        <label className="controlRow" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={speakerLabels}
            onChange={(event) => setSpeakerLabels(event.target.checked)}
            disabled={isTranscribing || isRecording || isCreatingProject}
            style={{ width: 14, height: 14 }}
          />
          <span style={{ fontSize: 13 }}>输出说话人标签（说话人1：文本）</span>
        </label>

        <div className="controlRow">
          <Button variant={isRecording ? "danger" : "primary"} onClick={isRecording ? handleStopRecording : handleStartRecording} disabled={isTranscribing || isCreatingProject} icon={isRecording ? Square : Mic}>
            {isRecording ? "停止录音" : "开始录音"}
          </Button>
          <label className="btn btn-secondary" style={{ cursor: isTranscribing || isCreatingProject ? "not-allowed" : "pointer", opacity: isTranscribing || isCreatingProject ? 0.45 : 1 }}>
            <Upload size={15} />
            上传音频
            <input type="file" accept="audio/*" onChange={handleUpload} disabled={isTranscribing || isRecording || isCreatingProject} style={{ display: "none" }} />
          </label>
          <Button variant="primary" onClick={handleRecognize} disabled={isTranscribing || isRecording || isCreatingProject || !pendingAudio?.blob}>
            开始识别
          </Button>
          <Button variant="danger" onClick={handleAbortRecognize} disabled={!isTranscribing}>
            终止识别
          </Button>
          <Button variant="secondary" onClick={handleUnloadAsr} disabled={isTranscribing || isRecording || isCreatingProject}>
            卸载 ASR
          </Button>
        </div>

        {pendingAudio?.url ? (
          <audio controls preload="metadata" style={{ width: "100%" }} src={pendingAudio.url} />
        ) : null}

        <div className="editorGrid two" style={{ marginTop: 8 }}>
          <div className="formGroup">
            <label className="formLabel">项目名称</label>
            <input
              className="textInput"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="可留空，默认取音频文件名"
              disabled={isTranscribing || isRecording || isCreatingProject}
            />
          </div>
          <div className="formGroup" style={{ justifyContent: "flex-end", display: "flex", alignItems: "flex-end" }}>
            <Button
              variant="primary"
              icon={FolderPlus}
              onClick={handleCreateProjectFromAudio}
              disabled={isTranscribing || isRecording || isCreatingProject || !pendingAudio?.blob}
            >
              {isCreatingProject ? "转项目中..." : "一键转项目"}
            </Button>
          </div>
        </div>

        {isTranscribing ? <div className="statusBadge default">识别中...</div> : null}
        {isCreatingProject ? <div className="statusBadge default">正在分块转写并创建项目...</div> : null}
        {backendUsed ? <div className="muted">实际后端：{backendUsed}</div> : null}
        {modelFiles?.main_model_path ? <div className="muted" title={modelFiles.main_model_path}>模型：{modelFiles.main_model_path}</div> : null}
        {error ? <div className="errorText">{error}</div> : null}
        {warnings.length ? (
          <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
            {warnings.join(" | ")}
          </div>
        ) : null}
        {projectTask?.chunkProgress?.total ? (
          <div className="muted">
            分块进度：{Number(projectTask.chunkProgress.completed || 0)} / {Number(projectTask.chunkProgress.total || 0)}
            {projectTask.status ? ` · 状态：${projectTask.status}` : ""}
          </div>
        ) : null}
        {projectTask?.warnings?.length ? (
          <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
            {projectTask.warnings.join(" | ")}
          </div>
        ) : null}
        {projectTask?.failedChunks?.length ? (
          <div className="errorText">失败分块：{projectTask.failedChunks.map((item) => `#${item.index + 1}`).join(", ")}</div>
        ) : null}
        {projectTask?.parseTaskId ? <div className="muted">自动解析任务：{projectTask.parseTaskId}</div> : null}
        </GlassCard>
      </div>

      <div className="speechPageColumn">
        <GlassCard>
        <h2 className="cardTitle">
          <WandSparkles size={16} />
          识别预览
        </h2>
        <textarea
          className="textArea"
          style={{ minHeight: 260 }}
          value={previewText}
          readOnly={speakerLabels && remappedAlignments.length > 0}
          onChange={(event) => {
            if (speakerLabels) {
              if (remappedAlignments.length) return;
              setTranscript(event.target.value);
            } else {
              setPlainText(event.target.value);
            }
          }}
          placeholder="识别结果将显示在这里。"
        />
        {speakerLabels && Array.isArray(alignments) && alignments.length ? (
          <div className="listStack" style={{ marginTop: 8 }}>
            <div className="muted">说话人映射（空值会回退原标签，可重名用于合并）</div>
            <div className="muted">当前预览由分段时间轴实时生成，可直接改右侧目标名。</div>
            {Object.keys(speakerMap || {}).map((source) => (
              <div key={source} className="editorGrid two">
                <div className="muted">{source}</div>
                <input
                  className="textInput"
                  value={speakerMap?.[source] ?? ""}
                  onChange={(event) => updateSpeakerMapEntry(source, event.target.value)}
                  placeholder={source}
                  disabled={isTranscribing || isRecording || isCreatingProject}
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="controlRow">
          <Button variant="primary" onClick={handleAppendToText} disabled={!canInsert}>
            追加到文本输入
          </Button>
          <Button variant="secondary" onClick={handleReplaceText} disabled={!canInsert}>
            替换文本输入
          </Button>
          <Button variant="ghost" onClick={handleClearResult} disabled={!transcript && !plainText}>
            清空结果
          </Button>
        </div>
        </GlassCard>

        <GlassCard>
        <h2 className="cardTitle">
          <Languages size={16} />
          翻译润色
        </h2>
        <p className="cardSubtitle">从识别预览读取文本，按选定来源执行“仅润色”或“翻译+润色”。</p>

        <div className="editorGrid three">
          <div className="formGroup">
            <label className="formLabel">来源</label>
            <select className="textInput" value={translationSource} onChange={(e) => setTranslationSource(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject}>
              <option value="primary_local">模型1（主模型）</option>
              <option value="secondary_local">模型2（小模型）</option>
              <option value="openai">OpenAI API</option>
              <option value="gemini">Gemini API</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">模式</label>
            <select className="textInput" value={translationMode} onChange={(e) => setTranslationMode(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject}>
              <option value="polish_only">仅润色</option>
              <option value="translate_polish">翻译+润色</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">目标语言</label>
            <select className="textInput" value={translationTargetLanguage} onChange={(e) => setTranslationTargetLanguage(e.target.value)} disabled={translationMode !== "translate_polish" || isLoadingTranslationEngine || isTranslating || isCreatingProject}>
              <option value="中文">中文</option>
              <option value="英文">英文</option>
              <option value="日文">日文</option>
            </select>
          </div>
        </div>

        <div className="controlRow">
          <Button variant="secondary" onClick={handleLoadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject}>
            加载翻译引擎
          </Button>
          <Button variant="secondary" onClick={handleUnloadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject}>
            卸载翻译引擎
          </Button>
          <Button
            variant="primary"
            onClick={handleTranslatePolish}
            disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || !isTranslationEngineLoaded}
          >
            翻译润色
          </Button>
          <Button variant="danger" onClick={handleAbortTranslate} disabled={!isTranslating}>
            终止翻译
          </Button>
        </div>

        <div className="muted">
          引擎状态：{translationEngineStatus?.loaded ? "已加载" : "未加载"} · 来源：{translationEngineStatus?.source || "未选择"} · 后端：{translationEngineStatus?.backend || "unknown"}
        </div>
        {translationEngineStatus?.model_name ? <div className="muted">模型：{translationEngineStatus.model_name}</div> : null}
        {translationEngineStatus?.error ? <div className="errorText">{translationEngineStatus.error}</div> : null}
        {translationError ? <div className="errorText">{translationError}</div> : null}

        <textarea
          className="textArea"
          style={{ minHeight: 220 }}
          value={translationResult}
          onChange={(event) => setTranslationResult(event.target.value)}
          placeholder="翻译润色结果将显示在这里。"
        />

        <div className="controlRow">
          <Button variant="primary" onClick={handleAppendTranslationToText} disabled={!canInsertTranslation}>
            追加到文本输入
          </Button>
          <Button variant="secondary" onClick={handleReplaceTranslationToText} disabled={!canInsertTranslation}>
            替换文本输入
          </Button>
          <Button variant="ghost" onClick={clearTranslationResult} disabled={!translationResult}>
            清空翻译结果
          </Button>
        </div>
        </GlassCard>
      </div>
    </div>
  );
}
