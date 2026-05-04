import { Mic, Square, Upload, WandSparkles } from "lucide-react";
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
  const clearResult = useSpeechRecognitionStore((state) => state.clearResult);
  const sourceText = useScriptStore((state) => state.sourceText);
  const setSourceText = useScriptStore((state) => state.setSourceText);

  const canInsert = useMemo(() => Boolean((speakerLabels ? transcript : plainText).trim()), [plainText, speakerLabels, transcript]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (pendingAudio?.url) {
        URL.revokeObjectURL(pendingAudio.url);
      }
    };
  }, [pendingAudio]);

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
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
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
    </div>
  );
}
