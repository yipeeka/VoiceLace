import { Languages, Mic, Square, Upload, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { useScriptStore } from "../stores/useScriptStore";
import { useSpeechRecognitionStore } from "../stores/useSpeechRecognitionStore";
import { useUiStore } from "../stores/useUiStore";
import { API_BASE_URL } from "../utils/api";
import { appendSpeechText, replaceSpeechText } from "../utils/speechText";

export default function SpeechRecognitionPage({ onNavigate }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const abortRef = useRef(null);
  const translateAbortRef = useRef(null);
  const speakerLabels = useSpeechRecognitionStore((state) => state.speakerLabels);
  const setSpeakerLabels = useSpeechRecognitionStore((state) => state.setSpeakerLabels);
  const transcript = useSpeechRecognitionStore((state) => state.transcript);
  const setTranscript = useSpeechRecognitionStore((state) => state.setTranscript);
  const plainText = useSpeechRecognitionStore((state) => state.plainText);
  const setPlainText = useSpeechRecognitionStore((state) => state.setPlainText);
  const warnings = useSpeechRecognitionStore((state) => state.warnings);
  const setWarnings = useSpeechRecognitionStore((state) => state.setWarnings);
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
  const sourceText = useScriptStore((state) => state.sourceText);
  const setSourceText = useScriptStore((state) => state.setSourceText);
  const [isLoadingTranslationEngine, setIsLoadingTranslationEngine] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const isTranslationEngineLoaded = Boolean(translationEngineStatus?.loaded);

  const canInsert = useMemo(() => Boolean((speakerLabels ? transcript : plainText).trim()), [plainText, speakerLabels, transcript]);
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
      setPlainText(nextPlainText);
      setTranscript(nextLabeledText || nextPlainText);
      setWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
      setBackendUsed(String(payload?.backend || "whisper"));
      setModelFiles(payload?.model_files || null);
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
    const input = (speakerLabels ? transcript : plainText).trim();
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

  function handleAppendToText() {
    const toInsert = (speakerLabels ? transcript : plainText).trim();
    if (!toInsert) {
      return;
    }
    setSourceText(appendSpeechText(sourceText, toInsert));
    useUiStore.getState().pushToast({ title: "已追加到文本输入", tone: "success" });
    onNavigate?.("text");
  }

  function handleReplaceText() {
    const toInsert = (speakerLabels ? transcript : plainText).trim();
    if (!toInsert) {
      return;
    }
    setSourceText(replaceSpeechText(toInsert));
    useUiStore.getState().pushToast({ title: "已替换文本输入内容", tone: "success" });
    onNavigate?.("text");
  }

  function handleClearResult() {
    clearResult();
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

  return (
    <div className="pageGrid twoCols">
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
            disabled={isTranscribing || isRecording}
            style={{ width: 14, height: 14 }}
          />
          <span style={{ fontSize: 13 }}>输出说话人标签（说话人1：文本）</span>
        </label>

        <div className="controlRow">
          <Button variant={isRecording ? "danger" : "primary"} onClick={isRecording ? handleStopRecording : handleStartRecording} disabled={isTranscribing} icon={isRecording ? Square : Mic}>
            {isRecording ? "停止录音" : "开始录音"}
          </Button>
          <label className="btn btn-secondary" style={{ cursor: isTranscribing ? "not-allowed" : "pointer", opacity: isTranscribing ? 0.45 : 1 }}>
            <Upload size={15} />
            上传音频
            <input type="file" accept="audio/*" onChange={handleUpload} disabled={isTranscribing || isRecording} style={{ display: "none" }} />
          </label>
          <Button variant="primary" onClick={handleRecognize} disabled={isTranscribing || isRecording || !pendingAudio?.blob}>
            开始识别
          </Button>
          <Button variant="danger" onClick={handleAbortRecognize} disabled={!isTranscribing}>
            终止识别
          </Button>
          <Button variant="secondary" onClick={handleUnloadAsr} disabled={isTranscribing || isRecording}>
            卸载 ASR
          </Button>
        </div>

        {pendingAudio?.url ? (
          <audio controls preload="metadata" style={{ width: "100%" }} src={pendingAudio.url} />
        ) : null}

        {isTranscribing ? <div className="statusBadge default">识别中...</div> : null}
        {backendUsed ? <div className="muted">实际后端：{backendUsed}</div> : null}
        {modelFiles?.main_model_path ? <div className="muted" title={modelFiles.main_model_path}>模型：{modelFiles.main_model_path}</div> : null}
        {error ? <div className="errorText">{error}</div> : null}
        {warnings.length ? (
          <div className="statusBadge warning" style={{ display: "block", textAlign: "left" }}>
            {warnings.join(" | ")}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">
          <WandSparkles size={16} />
          识别预览
        </h2>
        <textarea
          className="textArea"
          style={{ minHeight: 260 }}
          value={speakerLabels ? transcript : plainText}
          onChange={(event) => {
            if (speakerLabels) {
              setTranscript(event.target.value);
            } else {
              setPlainText(event.target.value);
            }
          }}
          placeholder="识别结果将显示在这里。"
        />
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

      <GlassCard className="speechTranslationCard">
        <h2 className="cardTitle">
          <Languages size={16} />
          翻译润色
        </h2>
        <p className="cardSubtitle">从识别预览读取文本，按选定来源执行“仅润色”或“翻译+润色”。</p>

        <div className="editorGrid three">
          <div className="formGroup">
            <label className="formLabel">来源</label>
            <select className="textInput" value={translationSource} onChange={(e) => setTranslationSource(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating}>
              <option value="primary_local">模型1（主模型）</option>
              <option value="secondary_local">模型2（小模型）</option>
              <option value="openai">OpenAI API</option>
              <option value="gemini">Gemini API</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">模式</label>
            <select className="textInput" value={translationMode} onChange={(e) => setTranslationMode(e.target.value)} disabled={isLoadingTranslationEngine || isTranslating}>
              <option value="polish_only">仅润色</option>
              <option value="translate_polish">翻译+润色</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">目标语言</label>
            <select className="textInput" value={translationTargetLanguage} onChange={(e) => setTranslationTargetLanguage(e.target.value)} disabled={translationMode !== "translate_polish" || isLoadingTranslationEngine || isTranslating}>
              <option value="中文">中文</option>
              <option value="英文">英文</option>
              <option value="日文">日文</option>
            </select>
          </div>
        </div>

        <div className="controlRow">
          <Button variant="secondary" onClick={handleLoadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating}>
            加载翻译引擎
          </Button>
          <Button variant="secondary" onClick={handleUnloadTranslationEngine} disabled={isLoadingTranslationEngine || isTranslating}>
            卸载翻译引擎
          </Button>
          <Button
            variant="primary"
            onClick={handleTranslatePolish}
            disabled={isLoadingTranslationEngine || isTranslating || !isTranslationEngineLoaded}
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
  );
}
