import { Mic, Square, Upload } from "lucide-react";

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
  onAsrLanguageChange,
  onRecognize,
  onSpeakerLabelsChange,
  onStartRecording,
  onStopRecording,
  onUnloadAsr,
  onUpload,
  pendingAudio,
  projectTask,
  showTimestampToggle,
  speakerLabelHint,
  speakerLabels,
  warnings,
}) {
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
          <label className="formLabel">ASR 后端</label>
          <select
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
          <label className="formLabel">识别语言</label>
          <select
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
        <label className={`btn btn-secondary uploadAudioButton ${uploadDisabled ? "disabled" : ""}`}>
          <Upload size={15} />
          上传音频
          <input type="file" accept="audio/*" onChange={onUpload} disabled={isTranscribing || isRecording || isCreatingProject} className="hiddenFileInput" />
        </label>
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
        <audio controls preload="metadata" className="fullWidthAudio" src={pendingAudio.url} />
      ) : null}

      {isTranscribing ? <div className="statusBadge default">识别中...</div> : null}
      {isCreatingProject ? <div className="statusBadge default">正在分块转写并创建项目...</div> : null}
      {backendUsed ? <div className="muted">实际后端：{backendUsed}</div> : null}
      {modelFiles?.main_model_path ? <div className="muted" title={modelFiles.main_model_path}>模型：{modelFiles.main_model_path}</div> : null}
      {error ? <div className="errorText">{error}</div> : null}
      {warnings.length ? (
        <div className="statusBadge warning blockStatus">
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
        <div className="statusBadge warning blockStatus">
          {projectTask.warnings.join(" | ")}
        </div>
      ) : null}
      {projectTask?.failedChunks?.length ? (
        <div className="errorText">失败分块：{projectTask.failedChunks.map((item) => `#${item.index + 1}`).join(", ")}</div>
      ) : null}
      {projectTask?.parseTaskId ? <div className="muted">自动解析任务：{projectTask.parseTaskId}</div> : null}
    </GlassCard>
  );
}
