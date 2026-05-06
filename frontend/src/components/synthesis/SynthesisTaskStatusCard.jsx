import { Download, Upload } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Progress from "../ui/Progress";

export default function SynthesisTaskStatusCard({
  API_ORIGIN,
  staleReport,
  staleSummary,
  modelStatus,
  status,
  connectionStatus,
  progress,
  totalSegments,
  taskId,
  lastSyncError,
  isRunning,
  progressPct,
  fullAudioUrl,
  rawAudioUrl,
  processedAudioUrl,
  chapterExports = [],
  audioVariant = "raw",
  onAudioVariantChange,
  subtitleSrtUrl,
  subtitleLrcUrl,
  currentProject,
  importWarnings,
  archiveInputRef,
  onImportArchive,
}) {
  const normalizedChapterExports = Array.isArray(chapterExports) ? chapterExports : [];
  return (
    <GlassCard>
      <h2 className="cardTitle">任务状态</h2>
      {staleReport && (staleReport.stale_count > 0 || staleReport.missing_count > 0) ? (
        <div className="statusBadge warning" style={{ marginBottom: 8 }}>
          共 {staleReport.total} 段，其中已修改 {staleSummary.modified} 段，配置变化 {staleSummary.config} 段，缺失{" "}
          {staleSummary.missing} 段
        </div>
      ) : null}
      <div className="listStack">
        <div className="statRow">
          <span>状态</span>
          <strong>{modelStatus || status}</strong>
        </div>
        <div className="statRow">
          <span>连接</span>
          <strong>{connectionStatus}</strong>
        </div>
        <div className="statRow">
          <span>进度</span>
          <strong style={{ fontFamily: "monospace" }}>
            {progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}
          </strong>
        </div>
        <div className="statRow">
          <span>Task ID</span>
          <strong style={{ fontFamily: "monospace", fontSize: 11 }}>{taskId || "—"}</strong>
        </div>
      </div>
      {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
      {(isRunning || status !== "idle") && (
        <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
      )}
      {fullAudioUrl && (
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <a className="downloadLink" href={fullAudioUrl} target="_blank" rel="noreferrer">
            <Download size={14} />
            下载当前音频
          </a>
          {rawAudioUrl ? (
            <a className="downloadLink" href={rawAudioUrl} target="_blank" rel="noreferrer">
              下载原始音频
            </a>
          ) : null}
          {processedAudioUrl ? (
            <a className="downloadLink" href={processedAudioUrl} target="_blank" rel="noreferrer">
              下载后处理音频
            </a>
          ) : null}
          {subtitleSrtUrl ? (
            <a className="downloadLink" href={subtitleSrtUrl} target="_blank" rel="noreferrer">
              下载 SRT
            </a>
          ) : null}
          {subtitleLrcUrl ? (
            <a className="downloadLink" href={subtitleLrcUrl} target="_blank" rel="noreferrer">
              下载 LRC
            </a>
          ) : null}
          {currentProject?.id ? (
            <a
              className="downloadLink"
              href={`${API_ORIGIN}/api/v1/tts/export/${currentProject.id}/archive`}
              target="_blank"
              rel="noreferrer"
            >
              下载完整工程 ZIP
            </a>
          ) : null}
        </div>
      )}
      <div className="controlRow" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <Button
          variant={audioVariant === "raw" ? "primary" : "secondary"}
          size="sm"
          disabled={!rawAudioUrl}
          onClick={() => onAudioVariantChange?.("raw")}
        >
          播放原始
        </Button>
        <Button
          variant={audioVariant === "processed" ? "primary" : "secondary"}
          size="sm"
          disabled={!processedAudioUrl}
          onClick={() => onAudioVariantChange?.("processed")}
        >
          播放后处理
        </Button>
      </div>
      {normalizedChapterExports.length ? (
        <div className="listStack" style={{ marginTop: 8 }}>
          {normalizedChapterExports.map((chapter) => (
            <div key={chapter.id} className="statRow" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {chapter.title || chapter.id}
              </span>
              <div className="controlRow" style={{ gap: 8 }}>
                {chapter.wav_url ? (
                  <a className="downloadLink" href={`${API_ORIGIN}${chapter.wav_url}`} target="_blank" rel="noreferrer">
                    WAV
                  </a>
                ) : null}
                {chapter.mp3_url ? (
                  <a className="downloadLink" href={`${API_ORIGIN}${chapter.mp3_url}`} target="_blank" rel="noreferrer">
                    MP3
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="controlRow" style={{ marginTop: 10 }}>
        <Button variant="secondary" size="sm" icon={Upload} onClick={() => archiveInputRef.current?.click()}>
          导入工程 ZIP
        </Button>
        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: "none" }}
          onChange={onImportArchive}
        />
      </div>
      {importWarnings?.length ? (
        <div className="statusBadge warning" style={{ marginTop: 10, display: "block", textAlign: "left" }}>
          {importWarnings.map((warning, idx) => (
            <div key={`${idx}-${warning}`}>导入提示 {idx + 1}: {warning}</div>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}
