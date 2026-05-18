import { Mic, Square, Upload } from "lucide-react";
import { useId, useRef } from "react";

import AudioClipper from "./AudioClipper";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";

export default function AsrRecognitionCard({
  asrBackendConfigured,
  asrLanguage,
  asrLanguageOptions,
  asrUnavailableReason,
  backendUsed,
  error,
  isCreatingProject,
  isQwen3Backend,
  isRecording,
  isTranscribing,
  modelFiles,
  onAbortRecognize,
  onAsrBackendChange,
  onAudioClipDurationChange,
  onAudioClipError,
  onAudioClipRangeChange,
  onAsrLanguageChange,
  onRecognize,
  onSpeakerLabelsChange,
  onStartRecording,
  onStopRecording,
  onUnloadAsr,
  onUpload,
  onVocalSeparationChange,
  onVocalSeparationModelChange,
  pendingAudio,
  projectTask,
  audioClipRange,
  showTimestampToggle,
  speakerLabelHint,
  speakerLabels,
  vocalSeparationEnabled,
  vocalSeparationHint,
  vocalSeparationModel,
  warnings,
}) {
  const generatedId = useId();
  const uploadInputRef = useRef(null);
  const backendSelectId = `${generatedId}-asr-backend`;
  const languageSelectId = `${generatedId}-asr-language`;
  const demucsSelectId = `${generatedId}-demucs-model`;
  const isBusy = isTranscribing || isRecording || isCreatingProject;
  const uploadDisabled = isTranscribing || isCreatingProject;

  return (
    <GlassCard>
      <h2 className="cardTitle">
        <Mic size={16} />
        语音识别
      </h2>
      <p className="cardSubtitle">支持录音与上传音频，识别结果可直接接入文本输入。</p>

      <div className="muted">ASR 后端：{asrBackendConfigured === "qwen3_crispasr" ? "Qwen3-ASR (CrispASR)" : "Whisper / Faster-Whisper"}</div>

      <div className="editorGrid three speechAsrGrid">
        <div className="formGroup">
          <label className="formLabel" htmlFor={backendSelectId}>ASR 后端</label>
          <select
            id={backendSelectId}
            name="asr_backend"
            className="textInput"
            value={asrBackendConfigured}
            onChange={(event) => onAsrBackendChange(event.target.value)}
            disabled={isBusy}
          >
            <option value="whisper">Whisper / Faster-Whisper</option>
            <option value="qwen3_crispasr">Qwen3-ASR (CrispASR)</option>
          </select>
        </div>
        <div className="formGroup">
          <label className="formLabel" htmlFor={languageSelectId}>识别语言</label>
          <select
            id={languageSelectId}
            name="asr_language"
            className="textInput"
            value={asrLanguage || "auto"}
            onChange={(event) => onAsrLanguageChange(event.target.value)}
            disabled={isBusy}
          >
            {asrLanguageOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        {showTimestampToggle ? (
          <div className="muted speechAsrHint">
            Qwen3-ASR 当前为纯识别模式（不提供时间轴/说话人标签）
          </div>
        ) : null}
      </div>

      <div className="editorGrid three speechAsrGrid">
        <label className="controlRow inlineCheckRow">
          <input
            type="checkbox"
            checked={Boolean(vocalSeparationEnabled)}
            onChange={(event) => onVocalSeparationChange(event.target.checked)}
            disabled={isBusy}
          />
          <span>识别前提取人声</span>
        </label>
        <div className="formGroup">
          <label className="formLabel" htmlFor={demucsSelectId}>Demucs 模型</label>
          <select
            id={demucsSelectId}
            name="demucs_model"
            className="textInput"
            value={vocalSeparationModel || "htdemucs"}
            onChange={(event) => onVocalSeparationModelChange(event.target.value)}
            disabled={isBusy || !vocalSeparationEnabled}
          >
            <option value="htdemucs">htdemucs</option>
            <option value="htdemucs_ft">htdemucs_ft（高质量）</option>
          </select>
        </div>
        {vocalSeparationHint ? (
          <div className="muted speechAsrHint">{vocalSeparationHint}</div>
        ) : null}
      </div>

      {!isQwen3Backend ? (
        <>
          <label className="controlRow inlineCheckRow">
            <input
              type="checkbox"
              checked={speakerLabels}
              onChange={(event) => onSpeakerLabelsChange(event.target.checked)}
              disabled={isTranscribing || isRecording || isCreatingProject}
            />
            <span>输出说话人标签（说话人1：文本）</span>
          </label>
          {speakerLabelHint ? <div className="muted">{speakerLabelHint}</div> : null}
        </>
      ) : null}

      <div className="controlRow">
        <Button
          variant={isRecording ? "danger" : "primary"}
          onClick={isRecording ? onStopRecording : onStartRecording}
          disabled={isTranscribing || isCreatingProject}
          icon={isRecording ? Square : Mic}
        >
          {isRecording ? "停止录音" : "开始录音"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => uploadInputRef.current?.click()}
          disabled={uploadDisabled || isRecording}
          icon={Upload}
          className="uploadAudioButton"
        >
          上传音频
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/*"
          onChange={onUpload}
          disabled={isTranscribing || isRecording || isCreatingProject}
          className="hiddenFileInput"
          tabIndex={-1}
        />
        <Button variant="primary" onClick={onRecognize} disabled={isBusy || !pendingAudio?.blob || Boolean(asrUnavailableReason)}>
          开始识别
        </Button>
        <Button variant="danger" onClick={onAbortRecognize} disabled={!isTranscribing}>
          终止识别
        </Button>
        <Button variant="secondary" onClick={onUnloadAsr} disabled={isBusy}>
          卸载 ASR
        </Button>
      </div>
      {asrUnavailableReason ? <div className="statusBadge warning">{asrUnavailableReason}</div> : null}

      {pendingAudio?.url ? (
        <AudioClipper
          audioUrl={pendingAudio.url}
          fileName={pendingAudio.fileName}
          disabled={isBusy}
          clipRange={audioClipRange}
          onClipRangeChange={onAudioClipRangeChange}
          onDurationChange={onAudioClipDurationChange}
          onError={onAudioClipError}
        />
      ) : null}

      {isTranscribing ? <div className="statusBadge default" aria-live="polite">识别中…</div> : null}
      {isCreatingProject ? <div className="statusBadge default" aria-live="polite">正在分块转写并创建项目…</div> : null}
      {backendUsed ? <div className="muted">实际后端：{backendUsed}</div> : null}
      {modelFiles?.main_model_path ? <div className="muted" title={modelFiles.main_model_path}>模型：{modelFiles.main_model_path}</div> : null}
      {error ? <div className="errorText" role="alert">{error}</div> : null}
      {warnings.length ? (
        <div className="statusBadge warning blockStatus" aria-live="polite">
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
        <div className="statusBadge warning blockStatus" aria-live="polite">
          {projectTask.warnings.join(" | ")}
        </div>
      ) : null}
      {projectTask?.failedChunks?.length ? (
        <div className="errorText" role="alert">失败分块：{projectTask.failedChunks.map((item) => `#${item.index + 1}`).join(", ")}</div>
      ) : null}
      {projectTask?.parseTaskId ? <div className="muted">自动解析任务：{projectTask.parseTaskId}</div> : null}
    </GlassCard>
  );
}
