import { FileText, FolderPlus, Languages, Mic, Square, Trash2, Upload, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import ProjectToolbarCard from "../components/text/ProjectToolbarCard";
import Button from "../components/ui/Button";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { useI18n } from "../i18n/I18nProvider";
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
import { runTaskChannel } from "../utils/taskChannel";
import { appendSpeechText, replaceSpeechText } from "../utils/speechText";

function DubbingProjectTargetDialog({
  open,
  kindLabel,
  defaultName,
  currentProject,
  t,
  onCancel,
  onCreateNew,
  onUseCurrent,
}) {
  const [name, setName] = useState(defaultName || "");

  useEffect(() => {
    if (open) {
      setName(defaultName || "");
    }
  }, [defaultName, open]);

  const canUseCurrent = Boolean(currentProject?.id);
  const projectName = name.trim() || defaultName || t("speech.dubbing.defaultProjectName");

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel?.(); }}>
      <DialogContent
        title={kindLabel || t("speech.dubbing.defaultProjectName")}
        description={t("speech.dubbing.targetDialog.description")}
      >
        <div className="dialogFormStack">
          <label className="fieldLabel">
            {t("speech.dubbing.targetDialog.newProjectName")}
            <input
              className="textInput"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={defaultName || t("speech.dubbing.defaultProjectName")}
            />
          </label>
          {canUseCurrent ? (
            <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
              {t("speech.dubbing.targetDialog.currentProjectWarning", { name: currentProject.name })}
            </div>
          ) : (
            <div className="muted">{t("speech.dubbing.targetDialog.noCurrentProject")}</div>
          )}
          <div className="controlRow" style={{ justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
            {canUseCurrent ? (
              <Button variant="secondary" onClick={() => onUseCurrent?.()}>{t("speech.dubbing.targetDialog.useCurrentProject")}</Button>
            ) : null}
            <Button variant="primary" onClick={() => onCreateNew?.(projectName)}>{t("speech.dubbing.targetDialog.createNewProject")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SpeechRecognitionPage({ onNavigate }) {
  const { t } = useI18n();
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
      return { sourceTag: t("project.unselected"), detail: t("project.unselectedDetail") };
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

  const formatTimestamp = useCallback((ms) => {
    const total = Math.max(0, Number(ms || 0));
    const hh = Math.floor(total / 3600000);
    const mm = Math.floor((total % 3600000) / 60000);
    const ss = Math.floor((total % 60000) / 1000);
    const mmm = Math.floor(total % 1000);
    const pad2 = (v) => String(v).padStart(2, "0");
    const pad3 = (v) => String(v).padStart(3, "0");
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`;
  }, []);

  const formatSrtTimestamp = useCallback((ms) => formatTimestamp(ms).replace(".", ","), [formatTimestamp]);

  const renderCuesAsSrt = useCallback((cues) => (Array.isArray(cues) ? cues : [])
    .map((cue, index) => {
      const text = String(cue?.raw_text || cue?.text || "").trim();
      const speaker = String(cue?.speaker || "").trim();
      const body = speaker && speaker !== "narrator" && !/^\s*[^：:\n]{1,40}\s*[：:]/.test(text)
        ? `${speaker}：${text}`
        : text;
      return [
        String(index + 1),
        `${formatSrtTimestamp(cue?.start_ms)} --> ${formatSrtTimestamp(cue?.end_ms)}`,
        body,
      ].join("\n");
    })
    .join("\n\n"), [formatSrtTimestamp]);

  const parseTimestampMs = useCallback((value) => {
    const raw = String(value || "").trim().replace(",", ".");
    const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
    if (!match) return null;
    const [, hh, mm, ss, ms] = match;
    return ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(String(ms).padEnd(3, "0").slice(0, 3));
  }, []);

  const splitSpeakerText = useCallback((value, fallbackSpeaker = "narrator") => {
    const raw = String(value || "").trim();
    const match = raw.match(/^\s*([^：:\n]{1,40})\s*[：:]\s*(.+)$/s);
    if (!match) {
      return { speaker: fallbackSpeaker || "narrator", text: raw };
    }
    const speaker = String(match[1] || "").trim() || fallbackSpeaker || "narrator";
    const text = String(match[2] || "").trim();
    return { speaker, text };
  }, []);

  const validateEditedSubtitleSrt = useCallback((value) => {
    const text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!text) {
      throw new Error(t("speech.subtitle.error.previewEmpty"));
    }
    const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
    if (!blocks.length) {
      throw new Error(t("speech.subtitle.error.noSubtitleBlocks"));
    }
    const timeRe = /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;
    blocks.forEach((block, index) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeLineIndex = lines.findIndex((line) => timeRe.test(line));
      if (timeLineIndex < 0) {
        throw new Error(t("speech.subtitle.error.blockMissingTimeline", { index: index + 1 }));
      }
      const match = lines[timeLineIndex].match(timeRe);
      const startMs = parseTimestampMs(match?.[1]);
      const endMs = parseTimestampMs(match?.[2]);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new Error(t("speech.subtitle.error.blockTimelineInvalid", { index: index + 1 }));
      }
      const body = lines.slice(timeLineIndex + 1).join("\n").trim();
      if (!body) {
        throw new Error(t("speech.subtitle.error.blockBodyEmpty", { index: index + 1 }));
      }
    });
    return `${text}\n`;
  }, [parseTimestampMs, t]);

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

  const collapseWhisperSegments = useCallback((text) => {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const parts = raw.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];
    const hasCjk = /[\u4e00-\u9fff]/.test(raw);
    return hasCjk ? parts.join("") : parts.join(" ");
  }, []);

  const asrBackendConfigured = asrBackend === "qwen3_crispasr" ? "qwen3_crispasr" : "whisper";
  const asrLanguageOptions = useMemo(() => [
    { value: "auto", label: t("speech.auto") },
    { value: "zh", label: t("speech.lang.zh") },
    { value: "en", label: t("speech.lang.en") },
    { value: "ja", label: t("speech.lang.ja") },
    { value: "ko", label: t("speech.lang.ko") },
    { value: "fr", label: t("speech.lang.fr") },
    { value: "de", label: t("speech.lang.de") },
    { value: "es", label: t("speech.lang.es") },
    { value: "ru", label: t("speech.lang.ru") },
  ], [t]);
  const derivedPreviewText = showTimeline && mappedTimelineText
    ? mappedTimelineText
    : (speakerLabels
      ? mappedTranscript
      : (asrBackendConfigured === "whisper" ? collapseWhisperSegments(plainText) : plainText));
  const stripTimelineText = useCallback((text) => String(text || "")
    .replace(/\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/g, "")
    .trim(), []);
  const previewText = editedPreviewText;
  const translationPlainInputText = stripTimelineText(editedPreviewText);
  const canInsert = useMemo(() => Boolean((previewText || "").trim()), [previewText]);
  const canInsertTranslation = useMemo(() => Boolean((translationResult || "").trim()), [translationResult]);
  const isQwen3Backend = asrBackendConfigured === "qwen3_crispasr";
  const qwen3Ready = Boolean(systemStatus?.qwen3_asr_ready);
  const asrUnavailableReason = useMemo(() => {
    if (asrBackendConfigured !== "qwen3_crispasr") return "";
    if (qwen3Ready) return "";
    return t("speech.error.qwen3NotReady");
  }, [asrBackendConfigured, qwen3Ready]);
  const showTimestampToggle = asrBackendConfigured === "qwen3_crispasr";
  const effectiveAsrEnableTimestamps = !isQwen3Backend && Boolean(asrEnableTimestamps);
  const speakerLabelHint = useMemo(() => {
    if (!speakerLabels) return "";
    if (asrBackendConfigured === "qwen3_crispasr") {
      return t("speech.hint.qwen3TimestampsAuto");
    }
    return t("speech.hint.whisperPyannoteAlign");
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
    if (!subtitleFile) return t("speech.subtitle.error.uploadSubtitleFirst");
    if (subtitleMode === "translated" && !isTranslationEngineLoaded) return t("speech.subtitle.error.loadEngineFirst");
    if (subtitleMode === "translated" && translationEngineStatus?.source !== translationSource) return t("speech.subtitle.error.engineSourceMismatch");
    if (subtitleMode === "translated" && !Array.isArray(subtitlePreview?.translated_segments)) return t("speech.subtitle.error.translateBeforeCreate");
    if (isPreviewingSubtitle) return t("speech.subtitle.error.previewingNow");
    if (isTranslatingSubtitle) return t("speech.subtitle.error.translatingNow");
    if (isCreatingSubtitleProject) return t("speech.subtitle.error.creatingNow");
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
    const usableTimeline = (remappedAlignments || [])
      .map((item, index) => ({
        id: String(item?.id || `asr-seg-${index + 1}`),
        speaker: String(item?.speaker || "narrator").trim() || "narrator",
        text: String(item?.text || "").trim(),
        start_ms: Number.isFinite(Number(item?.start_ms)) ? Number(item.start_ms) : null,
        end_ms: Number.isFinite(Number(item?.end_ms)) ? Number(item.end_ms) : null,
      }))
      .filter((item) => item.text && item.start_ms !== null && item.end_ms !== null && item.end_ms > item.start_ms);
    if (!usableTimeline.length) {
      throw new Error(t("speech.error.needWhisperTimelineFirst"));
    }
    const lines = String(editedPreviewText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      throw new Error(t("speech.error.previewEmpty"));
    }
    const timelineRe = /^\s*\[(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\]\s*(.+)$/s;
    const hasTimelineLines = lines.some((line) => timelineRe.test(line));
    if (hasTimelineLines) {
      return lines.map((line, index) => {
        const match = line.match(timelineRe);
        if (!match) {
          throw new Error(t("speech.error.lineNotValidTimeline", { index: index + 1 }));
        }
        const startMs = parseTimestampMs(match[1]);
        const endMs = parseTimestampMs(match[2]);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          throw new Error(t("speech.error.lineTimelineInvalid", { index: index + 1 }));
        }
        const base = usableTimeline[index] || {};
        const parsed = splitSpeakerText(match[3], base.speaker || "narrator");
        if (!parsed.text) {
          throw new Error(t("speech.error.lineTextEmpty", { index: index + 1 }));
        }
        return {
          id: String(base.id || `asr-seg-${index + 1}`),
          speaker: parsed.speaker,
          text: parsed.text,
          start_ms: startMs,
          end_ms: endMs,
        };
      });
    }
    if (lines.length !== usableTimeline.length) {
      throw new Error(t("speech.error.normalModeLineCountMismatch", { expected: usableTimeline.length, actual: lines.length }));
    }
    return lines.map((line, index) => {
      const base = usableTimeline[index];
      const parsed = splitSpeakerText(line, base.speaker);
      if (!parsed.text) {
        throw new Error(t("speech.error.lineTextEmpty", { index: index + 1 }));
      }
      return {
        ...base,
        speaker: parsed.speaker,
        text: parsed.text,
      };
    });
  }, [editedPreviewText, parseTimestampMs, remappedAlignments, splitSpeakerText, t]);

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
      const message = err?.message || t("speech.subtitle.error.previewFailed");
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
      setSubtitleProjectName((current) => current || (stem ? `${stem}-${t("speech.subtitle.mode.translated")}` : ""));
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
      setSubtitleError(t("speech.subtitle.error.uploadSubtitleFirst"));
      return;
    }
    if (!canCreateSubtitleProject) {
      setSubtitleError(subtitleCreateDisabledReason || t("speech.subtitle.error.cannotCreateNow"));
      return;
    }
    setIsCreatingSubtitleProject(true);
    setSubtitleError("");
    try {
      const target = await requestDubbingProjectTarget({
        kindLabel: t("speech.subtitle.createProject"),
        defaultName: subtitleProjectName.trim() || t("speech.dubbing.defaultProjectName"),
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
        throw new Error(t("speech.error.projectIdMissing"));
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
          ? t("speech.subtitle.toast.createdProject", { name: payload?.project?.name || target.projectName || subtitleProjectName || t("speech.dubbing.defaultProjectName") })
          : t("speech.subtitle.toast.updatedCurrentProject", { name: payload?.project?.name || target.projectName || t("project.current") }),
        tone: "success",
      });
      onNavigate?.("script");
    } catch (err) {
      const message = err?.message || t("speech.subtitle.error.createProjectFailed");
      setSubtitleError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.createFailed", { error: message }), tone: "error" });
    } finally {
      setIsCreatingSubtitleProject(false);
    }
  }

  async function handleTranslateSubtitle() {
    if (!subtitleFile) {
      setSubtitleError(t("speech.subtitle.error.uploadSubtitleFirst"));
      return;
    }
    if (!isTranslationEngineLoaded || translationEngineStatus?.source !== translationSource) {
      setSubtitleError(t("speech.subtitle.error.loadEngineBySourceFirst"));
      return;
    }
    setIsTranslatingSubtitle(true);
    setSubtitleError("");
    setSubtitleTask({ taskId: "", status: "queued", stageLabel: t("speech.subtitle.task.queued"), processed: 0, total: 0, percent: 0, cacheHits: 0 });
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
        throw new Error(t("speech.subtitle.error.taskIdMissing"));
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
              fail(new Error(String(body?.error || t("speech.subtitle.error.taskFailed"))));
              return true;
            }
            if (body?.status === "canceled") {
              fail(new Error(t("speech.subtitle.error.taskCanceled")));
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
            setSubtitleTask((current) => ({ ...current, status: "cancel_requested", stageLabel: String(msg.message || t("speech.subtitle.task.canceling")) }));
            return;
          }
          if (msg.type === "canceled") {
            fail(new Error(String(msg.message || t("speech.subtitle.error.taskCanceled"))));
            return;
          }
          if (msg.type === "complete") {
            done(msg.data || null);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(String(msg.message || t("speech.subtitle.error.taskFailed"))));
          }
        },
      });
      setSubtitleMode("translated");
      setSubtitlePreview(payload);
      setSubtitleTask((current) => ({ ...current, status: "done", stageLabel: t("speech.subtitle.task.done"), percent: 100 }));
      useUiStore.getState().pushToast({ title: t("speech.subtitle.toast.translateDone"), tone: "success" });
    } catch (err) {
      const message = err?.message || t("speech.subtitle.error.translateFailed");
      setSubtitleError(message);
      const canceled = /取消|canceled/i.test(message);
      setSubtitleTask((current) => ({ ...current, status: canceled ? "canceled" : "error", stageLabel: canceled ? t("speech.subtitle.task.canceled") : t("speech.subtitle.task.failed") }));
      useUiStore.getState().pushToast({ title: canceled ? t("speech.subtitle.toast.translateStopped") : t("speech.subtitle.toast.translateFailed", { error: message }), tone: canceled ? "info" : "error" });
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
      setSubtitleTask((current) => ({ ...current, status: "cancel_requested", stageLabel: t("speech.subtitle.task.canceling") }));
    } catch {
      setSubtitleTask((current) => ({ ...current, stageLabel: t("speech.task.cancelRequestFailed") }));
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
          fail(new Error(message || t("speech.error.autoParseFailed")));
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
          fail(new Error(String(msg.message || t("speech.error.autoParseFailed"))));
          return;
        }
        if (msg.type === "canceled") {
          fail(new Error(String(msg.message || t("speech.error.autoParseCanceled"))));
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
            status: t("speech.task.parsingProgress", { percent: Number(msg.percent || 0) }),
            parseTaskId: taskId,
          }));
          return;
        }
        if (msg.type === "task_status") {
          setProjectTask((prev) => ({
            ...prev,
            status: msg.status === "done" ? t("speech.task.parseDone") : String(msg.status || prev.status || "parse_running"),
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
        error: err?.message || t("speech.error.translationEngineStatusFailed"),
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
        setError(t("speech.error.emptyRecognitionResult"));
      } else {
        useUiStore.getState().pushToast({ title: t("speech.toast.recognitionDone"), tone: "success" });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError(t("speech.toast.recognitionStopped"));
        useUiStore.getState().pushToast({ title: t("speech.toast.recognitionStopped"), tone: "warning" });
        return;
      }
      const message = err?.message || t("speech.toast.recognitionFailed");
      setError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.recognitionFailedWithError", { error: message }), tone: "error" });
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
      setError(t("speech.error.browserNoRecordingSupport"));
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
      const message = err?.message || t("speech.error.recordingPermissionDenied");
      setError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.recordingFailed", { error: message }), tone: "error" });
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
      setError(t("speech.error.uploadOrRecordFirst"));
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
      useUiStore.getState().pushToast({ title: t("speech.toast.asrUnloaded"), tone: "success" });
    } catch (err) {
      const message = err?.message || t("speech.toast.unloadAsrFailed");
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
      useUiStore.getState().pushToast({ title: t("speech.toast.translationEngineLoaded"), tone: "success" });
    } catch (err) {
      const message = err?.message || t("speech.toast.loadTranslationEngineFailed");
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.loadFailed", { error: message }), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("speech.toast.translationEngineUnloaded"), tone: "success" });
    } catch (err) {
      const message = err?.message || t("speech.toast.unloadTranslationEngineFailed");
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.unloadFailed", { error: message }), tone: "error" });
      await refreshTranslationStatus();
    } finally {
      setIsLoadingTranslationEngine(false);
    }
  }

  async function handleTranslatePolish() {
    if (translationMode !== "passthrough" && !isTranslationEngineLoaded) {
      setTranslationError(t("speech.error.loadTranslationEngineFirst"));
      return;
    }
    const input = (translationPlainInputText || "").trim();
    if (!input) {
      setTranslationError(t("speech.error.needRecognitionOrPreviewInput"));
      return;
    }
    setIsTranslating(true);
    setTranslationError("");
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      if (translationMode === "passthrough") {
        setTranslationResult(input);
        useUiStore.getState().pushToast({ title: t("speech.toast.passthroughCopied"), tone: "success" });
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
      useUiStore.getState().pushToast({ title: t("speech.toast.translatePolishDone"), tone: "success" });
    } catch (err) {
      if (err?.name === "AbortError") {
        setTranslationError(t("speech.toast.translatePolishStopped"));
        return;
      }
      const message = err?.message || t("speech.toast.translatePolishFailed");
      setTranslationError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.translatePolishFailedWithError", { error: message }), tone: "error" });
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
        setDubbingTask((current) => ({ ...current, status: "cancel_requested", stageLabel: t("speech.dubbing.task.canceling") }));
      } catch {
        setDubbingTask((current) => ({ ...current, stageLabel: t("speech.task.cancelRequestFailed") }));
      }
      return;
    }
    if (!isTranslating || !translateAbortRef.current) return;
    translateAbortRef.current.abort();
  }

  async function handleCreateDubbingProject() {
    if (translationMode !== "passthrough" && !isTranslationEngineLoaded) {
      setTranslationError(t("speech.error.loadTranslationEngineFirst"));
      return;
    }
    if (isQwen3Backend) {
      setTranslationError(t("speech.error.qwen3NoTimelineForDubbing"));
      return;
    }
    let normalizedAlignments = [];
    try {
      normalizedAlignments = parseEditedPreviewDubbingSegments();
    } catch (err) {
      setTranslationError(err?.message || t("speech.error.previewFormatInvalidForDubbing"));
      return;
    }
    setIsBuildingDubbingProject(true);
    setTranslationError("");
    const taskLabel = translationMode === "passthrough" ? t("speech.dubbing.task.queuedPassthrough") : (translationMode === "polish_only" ? t("speech.dubbing.task.queuedPolish") : t("speech.dubbing.task.queuedTranslate"));
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
        throw new Error(t("speech.dubbing.error.taskIdMissing"));
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
              fail(new Error(String(body?.error || t("speech.dubbing.error.taskFailed"))));
              return true;
            }
            if (body?.status === "canceled") {
              fail(new Error(t("speech.dubbing.error.taskCanceled")));
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
            setDubbingTask((current) => ({ ...current, status: "cancel_requested", stageLabel: String(msg.message || t("speech.dubbing.task.canceling")) }));
            return;
          }
          if (msg.type === "canceled") {
            fail(new Error(String(msg.message || t("speech.dubbing.error.taskCanceled"))));
            return;
          }
          if (msg.type === "complete") {
            done(msg.data || null);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(String(msg.message || t("speech.dubbing.error.taskFailed"))));
          }
        },
      });
      const translatedSegments = Array.isArray(payload?.segments) ? payload.segments : [];
      if (!translatedSegments.length) {
        throw new Error(t("speech.dubbing.error.noSegmentsReturned"));
      }

      const audioStem = String(pendingAudio?.fileName || "").replace(/\.[^.]+$/, "");
      const baseName = (projectName || "").trim() || audioStem || t("speech.dubbing.projectBaseName");
      const modeProjectSuffix = translationMode === "passthrough" ? t("speech.dubbing.modeSuffix.passthrough") : (translationMode === "polish_only" ? t("speech.dubbing.modeSuffix.polish") : t("speech.dubbing.modeSuffix.translate"));
      const nextProjectName = `${baseName}-${modeProjectSuffix}`;
      const target = await requestDubbingProjectTarget({
        kindLabel: t("speech.dubbing.createProjectKindLabel"),
        defaultName: nextProjectName,
      });
      if (!target) {
        throw new Error(t("speech.dubbing.error.projectCreationCanceled"));
      }
      const finalProjectName = target.projectName || nextProjectName;
      const project = target.createNew ? await createProject(finalProjectName) : currentProject;
      if (!project?.id) {
        throw new Error(t("speech.dubbing.error.noProjectAvailable"));
      }

      const scriptPayload = {
        title: target.createNew ? finalProjectName : (target.projectName || project.name || nextProjectName),
        source_text: String(payload?.translated_text || "").trim(),
        metadata: {
          asr_source: true,
          dubbing_source: true,
          dubbing_mode: String(payload?.mode || translationMode),
          dubbing_target_language: String(translationTargetLanguage || t("speech.lang.zh")),
          dubbing_source_backend: String(translationSource || ""),
          dubbing_segment_count: Number(translatedSegments.length),
        },
        characters: [],
        segments: translatedSegments.map((segment, index) => {
          const segText = String(segment?.text || "").trim();
          const sourceText = String(segment?.source_text || "").trim();
          const startMs = Number.isFinite(Number(segment?.start_ms)) ? Number(segment.start_ms) : null;
          const endMs = Number.isFinite(Number(segment?.end_ms)) ? Number(segment.end_ms) : null;
          const durationMs = Number.isFinite(Number(segment?.duration_ms))
            ? Number(segment.duration_ms)
            : (startMs !== null && endMs !== null && endMs >= startMs ? endMs - startMs : null);
          const overrides = segment?.tts_overrides && typeof segment.tts_overrides === "object" ? segment.tts_overrides : {};
          return {
            id: String(segment?.id || `dub-seg-${index + 1}`),
            index,
            type: "dialogue",
            speaker: String(segment?.speaker || "narrator"),
            text: segText,
            emotion: "neutral",
            non_verbal: [],
            tts_overrides: overrides,
            source_text: sourceText,
            source_start_ms: startMs,
            source_end_ms: endMs,
            source_duration_ms: durationMs,
          };
        }),
      };

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
          title: t("speech.dubbing.toast.saveSourceAudioFailed", { error: sourceAudioError?.message || sourceAudioError }),
          tone: "warning",
        });
      }
      await selectProject(project.id, { suppressToast: true });
      await loadProjectScript(project.id);
      setTranslationResult(String(payload?.translated_text || "").trim());
      setDubbingTask((current) => ({ ...current, status: "done", stageLabel: t("speech.dubbing.task.done"), percent: 100 }));
      useUiStore.getState().pushToast({
        title: target.createNew ? t("speech.dubbing.toast.createdProject", { name: finalProjectName }) : t("speech.dubbing.toast.updatedCurrentProject", { name: project.name }),
        tone: "success",
      });
      onNavigate?.("script");
    } catch (err) {
      const message = err?.message || t("speech.dubbing.error.createProjectFailed");
      setTranslationError(message);
      const canceled = /取消|canceled/i.test(message);
      setDubbingTask((current) => ({ ...current, status: canceled ? "canceled" : "error", stageLabel: message }));
      useUiStore.getState().pushToast({ title: canceled ? t("speech.dubbing.toast.taskCanceled") : t("speech.toast.createFailed", { error: message }), tone: canceled ? "default" : "error" });
    } finally {
      dubbingTaskIdRef.current = "";
      setIsBuildingDubbingProject(false);
    }
  }

  async function handleCreateProjectFromAudio() {
    if (!pendingAudio?.blob) {
      setError(t("speech.error.uploadOrRecordFirst"));
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
        throw new Error(t("speech.error.taskIdMissingAfterCreate"));
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
              fail(new Error(String(body?.error || t("speech.error.asrTaskFailed"))));
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
            fail(new Error(String(msg.message || t("speech.error.asrTaskFailed"))));
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
        throw new Error(t("speech.error.projectIdMissingAfterCreate"));
      }

      await selectProject(nextProjectId, { suppressToast: true });
      await loadProjectScript(nextProjectId);

      let issueCount = 0;
      if (nextParseTaskId) {
        setProjectTask((prev) => ({ ...prev, status: t("speech.task.waitingAutoParse"), parseTaskId: nextParseTaskId }));
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
        title: nextFailed.length ? t("speech.toast.projectCreatedWithChunkFailures", { count: nextFailed.length }) : t("speech.toast.projectCreated"),
        tone: nextFailed.length ? "warning" : "success",
      });
      onNavigate?.(issueCount > 0 ? "qc" : "script");
    } catch (err) {
      const message = err?.message || t("speech.error.oneClickProjectFailed");
      setError(message);
      useUiStore.getState().pushToast({ title: t("speech.toast.oneClickProjectFailedWithError", { error: message }), tone: "error" });
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
    useUiStore.getState().pushToast({ title: t("speech.toast.appendedToText"), tone: "success" });
    onNavigate?.("text");
  }

  function handleReplaceText() {
    const toInsert = (previewText || "").trim();
    if (!toInsert) {
      return;
    }
    setSourceText(replaceSpeechText(toInsert));
    useUiStore.getState().pushToast({ title: t("speech.toast.replacedText"), tone: "success" });
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
    useUiStore.getState().pushToast({ title: t("speech.toast.translationAppended"), tone: "success" });
    onNavigate?.("text");
  }

  function handleReplaceTranslationToText() {
    const toInsert = (translationResult || "").trim();
    if (!toInsert) return;
    setSourceText(replaceSpeechText(toInsert));
    useUiStore.getState().pushToast({ title: t("speech.toast.translationReplaced"), tone: "success" });
    onNavigate?.("text");
  }

  async function handleSelectProject(projectId) {
    if (!projectId) return;
    await selectProject(projectId);
    await loadProjectScript(projectId);
  }

  async function handleCreateProject() {
    const name = newProjectName.trim() || t("speech.project.defaultName", { time: new Date().toLocaleTimeString() });
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
      useUiStore.getState().pushToast({ title: t("text.toast.projectNameRequired"), tone: "warning" });
      return;
    }
    if (nextName === currentProject.name) {
      useUiStore.getState().pushToast({ title: t("text.toast.projectNameUnchanged"), tone: "default" });
      return;
    }
    try {
      await renameProject(currentProject.id, nextName);
      setRenameProjectName(nextName);
    } catch (renameError) {
      useUiStore.getState().pushToast({
        title: t("text.toast.renameFailed", { error: renameError?.message || t("common.unknownError") }),
        tone: "error",
      });
    }
  }

  async function handleDeleteProject() {
    if (!currentProject?.id) {
      return;
    }
    const ok = window.confirm(t("text.confirm.deleteProject", { name: currentProject.name }));
    if (!ok) return;
    try {
      await deleteProject(currentProject.id, { silent: true });
      useUiStore.getState().pushToast({ title: t("text.toast.projectDeleted"), tone: "success" });
      const nextProjects = useProjectStore.getState().projects || [];
      const next = nextProjects[0];
      if (next?.id) {
        await handleSelectProject(next.id);
      }
    } catch {
      useUiStore.getState().pushToast({ title: t("text.toast.projectDeleteFailed"), tone: "warning" });
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
    const ok = window.confirm(t("text.confirm.deleteSameNameCopies", { count: siblingProjects.length, name: currentProject.name }));
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
      useUiStore.getState().pushToast({ title: t("text.toast.deletedSameNameCopies", { count: deletedCount }), tone: "success" });
    }
    if (failedIds.length) {
      useUiStore.getState().pushToast({ title: t("text.toast.deleteSameNameCopiesFailed", { count: failedIds.length }), tone: "warning" });
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
        title: t("text.toast.openProjectFileFailed", { error: openError?.message || t("common.unknownError") }),
        tone: "error",
      });
    }
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    if (!currentProject) {
      useUiStore.getState().pushToast({ title: t("synth.toast.selectProjectFirst"), tone: "warning" });
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
        title: forceSaveAs ? t("text.toast.projectSavedAs") : result?.mode === "inplace" ? t("text.toast.projectSaved") : t("text.toast.projectExported"),
        tone: "success",
      });
    } catch (saveError) {
      if (saveError?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({
        title: t("text.toast.saveProjectFailed", { error: saveError?.message || t("common.unknownError") }),
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
      label: t("text.menu.deleteCurrentProject"),
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id,
      onSelect: handleDeleteProject,
    },
    { type: "separator" },
    {
      label: sameNameSiblingProjects.length ? t("text.menu.deleteSameNameCopiesWithCount", { count: sameNameSiblingProjects.length }) : t("text.menu.deleteSameNameCopies"),
      icon: Trash2,
      danger: true,
      disabled: !currentProject?.id || sameNameSiblingProjects.length < 1,
      title: sameNameSiblingProjects.length
        ? t("text.menu.deleteSameNameCopiesHintWithCount", { count: sameNameSiblingProjects.length })
        : t("text.menu.deleteSameNameCopiesHintNone"),
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
              <div key={`${idx}-${warning}`}>{t("text.importHint")} {idx + 1}: {warning}</div>
            ))}
          </div>
        ) : null}
        </GlassCard>

        <GlassCard>
        <h2 className="cardTitle">
          <Mic size={16} />
          {t("speech.title")}
        </h2>
        <p className="cardSubtitle">{t("speech.subtitle")}</p>

        <div className="muted">{t("speech.asrBackendLine", {
          backend: asrBackendConfigured === "qwen3_crispasr" ? t("speech.asrBackend.qwen3") : t("speech.asrBackend.whisper"),
        })}</div>

        <div className="editorGrid three" style={{ marginTop: 6 }}>
          <div className="formGroup">
            <label className="formLabel">{t("speech.asrBackend")}</label>
            <select
              className="textInput"
              value={asrBackendConfigured}
              onChange={(event) => setAsrBackend(event.target.value)}
              disabled={isTranscribing || isRecording || isCreatingProject}
            >
              <option value="whisper">Whisper / Faster-Whisper</option>
              <option value="qwen3_crispasr">Qwen3-ASR (CrispASR)</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">{t("speech.recognitionLanguage")}</label>
            <select
              className="textInput"
              value={asrLanguage || "auto"}
              onChange={(event) => setAsrLanguage(event.target.value)}
              disabled={isTranscribing || isRecording || isCreatingProject}
            >
              {asrLanguageOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          {showTimestampToggle ? (
            <div className="muted" style={{ alignSelf: "end" }}>
              {t("speech.hint.qwen3PureRecognition")}
            </div>
          ) : null}
        </div>

        {!isQwen3Backend ? (
          <>
            <label className="controlRow" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={speakerLabels}
                onChange={(event) => setSpeakerLabels(event.target.checked)}
                disabled={isTranscribing || isRecording || isCreatingProject}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: 13 }}>{t("speech.outputSpeakerLabels")}</span>
            </label>
            {speakerLabelHint ? <div className="muted">{speakerLabelHint}</div> : null}
          </>
        ) : null}

        <div className="controlRow">
          <Button variant={isRecording ? "danger" : "primary"} onClick={isRecording ? handleStopRecording : handleStartRecording} disabled={isTranscribing || isCreatingProject} icon={isRecording ? Square : Mic}>
            {isRecording ? t("speech.stopRecording") : t("speech.startRecording")}
          </Button>
          <label className="btn btn-secondary" style={{ cursor: isTranscribing || isCreatingProject ? "not-allowed" : "pointer", opacity: isTranscribing || isCreatingProject ? 0.45 : 1 }}>
            <Upload size={15} />
            {t("speech.uploadAudio")}
            <input type="file" accept="audio/*" onChange={handleUpload} disabled={isTranscribing || isRecording || isCreatingProject} style={{ display: "none" }} />
          </label>
          <Button variant="primary" onClick={handleRecognize} disabled={isTranscribing || isRecording || isCreatingProject || !pendingAudio?.blob || Boolean(asrUnavailableReason)}>
            {t("speech.startRecognition")}
          </Button>
          <Button variant="danger" onClick={handleAbortRecognize} disabled={!isTranscribing}>
            {t("speech.stopRecognition")}
          </Button>
          <Button variant="secondary" onClick={handleUnloadAsr} disabled={isTranscribing || isRecording || isCreatingProject}>
            {t("speech.unloadAsr")}
          </Button>
        </div>
        {asrUnavailableReason ? <div className="statusBadge warning">{asrUnavailableReason}</div> : null}

        {pendingAudio?.url ? (
          <audio controls preload="metadata" style={{ width: "100%" }} src={pendingAudio.url} />
        ) : null}

        {isTranscribing ? <div className="statusBadge default">{t("speech.status.recognizing")}</div> : null}
        {isCreatingProject ? <div className="statusBadge default">{t("speech.status.creatingProjectFromChunks")}</div> : null}
        {backendUsed ? <div className="muted">{t("speech.runtimeBackend")}{backendUsed}</div> : null}
        {modelFiles?.main_model_path ? <div className="muted" title={modelFiles.main_model_path}>{t("speech.modelLabel")}{modelFiles.main_model_path}</div> : null}
        {error ? <div className="errorText">{error}</div> : null}
        {warnings.length ? (
          <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
            {warnings.join(" | ")}
          </div>
        ) : null}
        {projectTask?.chunkProgress?.total ? (
          <div className="muted">
            {t("speech.chunkProgress", { completed: Number(projectTask.chunkProgress.completed || 0), total: Number(projectTask.chunkProgress.total || 0) })}
            {projectTask.status ? ` · ${t("speech.statusLabel")}${projectTask.status}` : ""}
          </div>
        ) : null}
        {projectTask?.warnings?.length ? (
          <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
            {projectTask.warnings.join(" | ")}
          </div>
        ) : null}
        {projectTask?.failedChunks?.length ? (
          <div className="errorText">{t("speech.failedChunks")}{projectTask.failedChunks.map((item) => `#${item.index + 1}`).join(", ")}</div>
        ) : null}
        {projectTask?.parseTaskId ? <div className="muted">{t("speech.autoParseTask")}{projectTask.parseTaskId}</div> : null}
        </GlassCard>
      </div>

      <div className="speechPageColumn">
        <GlassCard>
        <div className="sectionHeader">
          <h2 className="cardTitle">
            <WandSparkles size={16} />
            {t("speech.preview")}
          </h2>
          {!isQwen3Backend ? (
            <label className="controlRow" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showTimeline}
                onChange={(event) => setShowTimeline(event.target.checked)}
                disabled={isTranscribing || isRecording || isCreatingProject || !remappedAlignments.length}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: 13 }}>{t("speech.showTimeline")}</span>
            </label>
          ) : null}
        </div>
        <textarea
          className="textArea"
          style={{ minHeight: 260 }}
          value={previewText}
          onChange={(event) => setEditedPreviewText(event.target.value)}
          placeholder={t("speech.previewPlaceholder")}
        />
        {speakerLabels && Array.isArray(alignments) && alignments.length ? (
          <div className="listStack" style={{ marginTop: 8 }}>
            <div className="muted">{t("speech.speakerMapTitle")}</div>
            <div className="muted">{t("speech.speakerMapHint")}</div>
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
            {t("speech.appendText")}
          </Button>
          <Button variant="secondary" onClick={handleReplaceText} disabled={!canInsert}>
            {t("speech.replaceText")}
          </Button>
          <Button variant="ghost" onClick={handleClearResult} disabled={!transcript && !plainText && !previewText}>
            {t("speech.clearResult")}
          </Button>
        </div>
        </GlassCard>

        <GlassCard>
          <Tabs value={utilityTab} onValueChange={setUtilityTab}>
            <TabsList>
              <TabsTrigger value="translate">{t("speech.polish.title")}</TabsTrigger>
              <TabsTrigger value="subtitle">{t("speech.subtitle.tab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="translate" className="speechUtilityTabContent">
              <h2 className="cardTitle speechUtilityTitle"><Languages size={16} /> {t("speech.polish.title")}</h2>
              <p className="cardSubtitle speechUtilitySubtitle">{t("speech.polish.subtitle")}</p>
              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">{t("speech.source")}</label>
                  <select className="textInput" value={translationSource} onChange={(e) => setTranslationSource(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>
                    <option value="primary_local">{t("speech.source.primaryLocal")}</option>
                    <option value="secondary_local">{t("speech.source.secondaryLocal")}</option>
                    <option value="openai">{t("speech.engine.option.openai")}</option>
                    <option value="gemini">{t("speech.engine.option.gemini")}</option>
                  </select>
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.mode")}</label>
                  <select className="textInput" value={translationMode} onChange={(e) => setTranslationMode(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>
                    <option value="passthrough">{t("speech.mode.passthrough")}</option>
                    <option value="polish_only">{t("speech.mode.polish_only")}</option>
                    <option value="translate_polish">{t("speech.mode.translate_polish")}</option>
                  </select>
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.targetLanguage")}</label>
                  <select className="textInput" value={translationTargetLanguage} onChange={(e) => setTranslationTargetLanguage(e.target.value)} disabled={translationMode !== "translate_polish" || isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>
                    <option value="中文">{t("speech.lang.zh")}</option>
                    <option value="英文">{t("speech.lang.en")}</option>
                    <option value="日文">{t("speech.lang.ja")}</option>
                  </select>
                </div>
              </div>
              <div className="controlRow speechUtilityActions">
                <Button variant="secondary" onClick={handleLoadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>{t("speech.engine.load")}</Button>
                <Button variant="secondary" onClick={handleUnloadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>{t("speech.engine.unload")}</Button>
                <Button variant="primary" onClick={handleTranslatePolish} disabled={isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject || (translationMode !== "passthrough" && !isTranslationEngineLoaded)}>
                  {translationMode === "passthrough" ? t("speech.action.passthroughPreview") : t("speech.action.translatePolish")}
                </Button>
                <Button variant="primary" icon={FolderPlus} onClick={handleCreateDubbingProject} disabled={!canBuildDubbingProject || isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject}>
                  {isBuildingDubbingProject ? t("speech.action.creatingDubbing") : t("speech.action.createDubbing")}
                </Button>
                <Button variant="danger" onClick={handleAbortTranslate} disabled={!isTranslating && !isBuildingDubbingProject}>
                  {isBuildingDubbingProject ? t("speech.action.stopDubbingTranslation") : t("speech.action.stopTranslation")}
                </Button>
              </div>
              <div className="muted">{t("speech.engine.status", {
                loaded: translationEngineStatus?.loaded ? t("speech.status.loaded") : t("speech.status.unloaded"),
                source: translationEngineStatus?.source || t("speech.source.unselected"),
                backend: translationEngineStatus?.backend || "unknown",
              })}</div>
              {translationEngineStatus?.model_name ? <div className="muted">{t("speech.modelLabel")}{translationEngineStatus.model_name}</div> : null}
              {!isQwen3Backend && translationMode === "passthrough" ? <div className="muted">{t("speech.hint.whisperPassthrough")}</div> : null}
              {!isQwen3Backend && translationMode !== "passthrough" ? <div className="muted">{t("speech.hint.whisperTranslate")}</div> : null}
              {isQwen3Backend ? <div className="muted">{t("speech.hint.qwen3")}</div> : null}
              {translationEngineStatus?.error ? <div className="errorText">{translationEngineStatus.error}</div> : null}
              {translationError ? <div className="errorText">{translationError}</div> : null}
              {isBuildingDubbingProject || dubbingTask.stageLabel ? (
                <div className="muted">
                  {t("speech.progress.dubbing", {
                    stage: dubbingTask.stageLabel || dubbingTask.status || t("speech.progress.processing"),
                    progress: dubbingTask.total ? ` · ${dubbingTask.processed}/${dubbingTask.total}` : "",
                    percent: dubbingTask.percent ? ` · ${Math.round(dubbingTask.percent)}%` : "",
                    cache: dubbingTask.cacheHits ? t("speech.progress.cacheHits", { count: dubbingTask.cacheHits }) : "",
                  })}
                </div>
              ) : null}
              <textarea className="textArea" style={{ minHeight: 220 }} value={translationResult} onChange={(event) => setTranslationResult(event.target.value)} placeholder={t("speech.polish.placeholder")} />
              <div className="controlRow">
                <Button variant="primary" onClick={handleAppendTranslationToText} disabled={!canInsertTranslation}>{t("speech.appendText")}</Button>
                <Button variant="secondary" onClick={handleReplaceTranslationToText} disabled={!canInsertTranslation}>{t("speech.replaceText")}</Button>
                <Button variant="ghost" onClick={clearTranslationResult} disabled={!translationResult}>{t("speech.clearTranslationResult")}</Button>
              </div>
            </TabsContent>

            <TabsContent value="subtitle" className="speechUtilityTabContent">
              <h2 className="cardTitle speechUtilityTitle"><FileText size={16} /> {t("speech.subtitle.title")}</h2>
              <p className="cardSubtitle speechUtilitySubtitle">{t("speech.subtitle.desc")}</p>
              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">{t("speech.subtitle.file")}</label>
                  <input className="textInput" type="file" accept=".srt,.ass,text/plain" onChange={handleSubtitleFileChange} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject} />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.subtitle.projectName")}</label>
                  <input className="textInput" value={subtitleProjectName} onChange={(event) => setSubtitleProjectName(event.target.value)} placeholder={t("speech.subtitle.projectNamePlaceholder")} disabled={isCreatingSubtitleProject} />
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.subtitle.mode")}</label>
                  <select className="textInput" value={subtitleMode} onChange={(event) => handleSubtitleModeChange(event.target.value)} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
                    <option value="original">{t("speech.subtitle.mode.original")}</option>
                    <option value="translated">{t("speech.subtitle.mode.translated")}</option>
                  </select>
                </div>
              </div>
              <div className="editorGrid three">
                <div className="formGroup">
                  <label className="formLabel">{t("speech.subtitle.linePolicy")}</label>
                  <select className="textInput" value={subtitleLinePolicy} onChange={(event) => handleSubtitleLinePolicyChange(event.target.value)} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
                    <option value="auto">{t("speech.auto")}</option>
                    <option value="first_line">{t("speech.subtitle.line.first")}</option>
                    <option value="second_line">{t("speech.subtitle.line.second")}</option>
                    <option value="all">{t("speech.subtitle.line.all")}</option>
                  </select>
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.subtitle.source")}</label>
                  <select className="textInput" value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} disabled={subtitleMode !== "translated" || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
                    <option value="primary_local">{t("speech.source.primaryLocal")}</option>
                    <option value="secondary_local">{t("speech.source.secondaryLocal")}</option>
                    <option value="openai">{t("speech.engine.option.openai")}</option>
                    <option value="gemini">{t("speech.engine.option.gemini")}</option>
                  </select>
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("speech.targetLanguage")}</label>
                  <select className="textInput" value={translationTargetLanguage} onChange={(event) => setTranslationTargetLanguage(event.target.value)} disabled={subtitleMode !== "translated" || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
                    <option value="中文">{t("speech.lang.zh")}</option>
                    <option value="英文">{t("speech.lang.en")}</option>
                    <option value="日文">{t("speech.lang.ja")}</option>
                  </select>
                </div>
              </div>
              <div className="controlRow speechUtilityActions">
                <Button variant="secondary" onClick={handleLoadTranslationEngine} disabled={subtitleMode !== "translated" || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>{t("speech.engine.load")}</Button>
                <Button variant="secondary" onClick={handleUnloadTranslationEngine} disabled={subtitleMode !== "translated" || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>{t("speech.engine.unload")}</Button>
                <Button variant="secondary" icon={Upload} onClick={() => previewSubtitleFile(subtitleFile, subtitleMode, subtitleLinePolicy, true)} disabled={!subtitleFile || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>{isPreviewingSubtitle ? t("speech.subtitle.previewing") : t("speech.subtitle.preview")}</Button>
                <Button variant="primary" onClick={handleTranslateSubtitle} disabled={subtitleMode !== "translated" || !subtitleFile || !isTranslationEngineLoaded || isTranslatingSubtitle || isCreatingSubtitleProject}>{isTranslatingSubtitle ? t("speech.subtitle.translating") : t("speech.subtitle.translate")}</Button>
                <Button variant="primary" icon={FolderPlus} onClick={handleCreateSubtitleDubbingProject} disabled={!canCreateSubtitleProject} title={subtitleCreateDisabledReason}>{isCreatingSubtitleProject ? t("speech.subtitle.creatingProject") : t("speech.subtitle.createProject")}</Button>
                <Button variant="danger" onClick={handleAbortSubtitleTranslate} disabled={!isTranslatingSubtitle}>{t("speech.subtitle.stopTranslate")}</Button>
              </div>
              <div className="muted">{t("speech.subtitle.engineStatus", {
                loaded: translationEngineStatus?.loaded ? t("speech.status.loaded") : t("speech.status.unloaded"),
                source: translationEngineStatus?.source || t("speech.source.unselected"),
                backend: translationEngineStatus?.backend || "unknown",
              })}</div>
              {subtitleMode === "translated" && ["openai", "gemini"].includes(translationSource) ? <div className="muted">{t("speech.subtitle.apiHint")}</div> : null}
              {isTranslatingSubtitle || subtitleTask.stageLabel ? (
                <div className="muted">
                  {t("speech.subtitle.progress", {
                    stage: subtitleTask.stageLabel || subtitleTask.status || t("speech.progress.processing"),
                    progress: subtitleTask.total ? ` · ${subtitleTask.processed}/${subtitleTask.total}` : "",
                    percent: subtitleTask.percent ? ` · ${Math.round(subtitleTask.percent)}%` : "",
                    cache: subtitleTask.cacheHits ? t("speech.progress.cacheHits", { count: subtitleTask.cacheHits }) : "",
                  })}
                </div>
              ) : null}
              {subtitleCreateDisabledReason && subtitleFile ? <div className="muted">{subtitleCreateDisabledReason}</div> : null}
              {subtitleError ? <div className="errorText">{subtitleError}</div> : null}
              {subtitlePreview ? (
                <div className="listStack" style={{ marginTop: 10 }}>
                  <div className="muted">{t("speech.subtitle.formatLine", {
                    format: String(subtitlePreview.format || "").toUpperCase(),
                    count: subtitlePreview.segment_count || 0,
                    speakers: (subtitlePreview.speakers || []).join("、") || "narrator",
                  })}</div>
                  {(subtitlePreview.warnings || []).slice(0, 4).map((warning, index) => <div key={`subtitle-warning-${index}`} className="muted">{t("speech.subtitle.warning", { warning })}</div>)}
                  <textarea
                    className="textArea"
                    style={{ minHeight: 280 }}
                    value={editedSubtitleSrtText}
                    onChange={(event) => {
                      setEditedSubtitleSrtText(event.target.value);
                      setSubtitlePreview((current) => {
                        if (!current?.translated_segments) return current;
                        return {
                          ...current,
                          translated_segments: undefined,
                          translated_text: "",
                          cues: (current.cues || []).map((cue) => ({ ...cue, translated_text: "" })),
                        };
                      });
                    }}
                    placeholder={t("speech.subtitle.previewPlaceholder")}
                    disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}
                  />
                  {(subtitlePreview.cues || []).some((cue) => cue?.translated_text) ? (
                    <div className="listStack">
                      {(subtitlePreview.cues || []).map((cue) => (
                        <div key={cue.id} className="segmentMetaRow" style={{ alignItems: "flex-start" }}>
                          <span className="statusBadge">{formatTimestamp(cue.start_ms)} - {formatTimestamp(cue.end_ms)}</span>
                          <span className="muted" style={{ minWidth: 72 }}>{cue.speaker || "narrator"}</span>
                          <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>
                            {cue.text}
                            {cue.translated_text ? <><br /><span className="muted">{t("speech.subtitle.translationLabel")}</span>{cue.translated_text}</> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        </GlassCard>
      </div>
      <DubbingProjectTargetDialog
        open={dubbingProjectDialog.open}
        kindLabel={dubbingProjectDialog.kindLabel}
        defaultName={dubbingProjectDialog.defaultName}
        currentProject={currentProject}
        t={t}
        onCancel={() => resolveDubbingProjectTarget(null)}
        onUseCurrent={() => {
          useUiStore.getState().pushToast({
            title: t("speech.dubbing.targetDialog.continueWithCurrentProject", { name: currentProject?.name || t("project.current") }),
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
