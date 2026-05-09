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
  queuePosition = 0,
  failedCount = 0,
  retryCount = 0,
  effectiveSegmentConcurrency = 1,
  queueSnapshot,
  runtimeStatus,
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
  onRetryFailed,
  onResume,
  onCancelTask,
  onOpenExportWizard,
}) {
  const normalizedChapterExports = Array.isArray(chapterExports) ? chapterExports : [];
  const gpu = runtimeStatus?.gpu || {};
  const queuedCount = Number(queueSnapshot?.queued_count || 0);
  const canResume = !isRunning && (failedCount > 0 || staleReport?.missing_count > 0 || staleReport?.stale_count > 0);
  const canRetryFailed = !isRunning && failedCount > 0;
  const canCancelQueued = status === "queued" || status === "cancel_requested" || isRunning;
  const projectId = currentProject?.id || "";
  const hasProject = Boolean(projectId);
  const buildExtendedUrl = (kind, format = "json", profile = "podcast") => (
    `${API_ORIGIN}/api/v1/tts/export/extended?project_id=${projectId}&kind=${encodeURIComponent(kind)}&format=${encodeURIComponent(format)}&variant=${encodeURIComponent(audioVariant || "raw")}&profile=${encodeURIComponent(profile)}`
  );
  return (
    <GlassCard>
      <h2 className="cardTitle">任务状态</h2>
      {staleReport && (staleReport.stale_count > 0 || staleReport.missing_count > 0) ? (
        <div className="statusBadge warning" style={{ marginBottom: 8 }}>
          共 {staleReport.total} 段，其中已修改 {staleSummary.modified} 段，配置变化 {staleSummary.config} 段，缺失{" "}
          {staleSummary.missing} 段
        </div>
      ) : null}
      <div className="taskStatusGrid">
        <div className="statRow taskStatusCell">
          <span>状态</span>
          <strong>{modelStatus || status}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>连接</span>
          <strong>{connectionStatus}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>进度</span>
          <strong style={{ fontFamily: "monospace" }}>
            {progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}
          </strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>排队位次</span>
          <strong>{queuePosition > 0 ? `#${queuePosition}` : "运行中/空闲"}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>队列长度</span>
          <strong>{queuedCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>失败段</span>
          <strong>{failedCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>重试次数</span>
          <strong>{retryCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>段并发</span>
          <strong>{effectiveSegmentConcurrency}</strong>
        </div>
        <div className="statRow taskStatusCell taskStatusCellWide">
          <span>模型</span>
          <strong>TTS {runtimeStatus?.tts_loaded ? "已加载" : "未加载"} / LLM {runtimeStatus?.llm_loaded ? "已加载" : "未加载"}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>显存</span>
          <strong>{gpu.used_vram_mb ?? 0} / {gpu.total_vram_mb ?? 0} MB</strong>
        </div>
        <div className="statRow taskStatusCell taskStatusCellWide">
          <span>Task ID</span>
          <strong style={{ fontFamily: "monospace", fontSize: 11 }}>{taskId || "—"}</strong>
        </div>
      </div>
      {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
      {(isRunning || status !== "idle") && (
        <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
      )}
      <div className="controlRow" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" disabled={!canResume} onClick={onResume}>
          继续合成
        </Button>
        <Button variant="secondary" size="sm" disabled={!canRetryFailed} onClick={onRetryFailed}>
          只重试失败段
        </Button>
        <Button variant="danger" size="sm" disabled={!canCancelQueued} onClick={onCancelTask}>
          {status === "queued" ? "取消排队" : "停止任务"}
        </Button>
      </div>
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
              下载后期处理音频
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
      {hasProject ? (
        <details className="listStack" style={{ marginTop: 8 }}>
          <summary className="statRow" style={{ cursor: "pointer", listStyle: "none" }}>
            <span>扩展导出</span>
            <strong style={{ fontFamily: "monospace", fontSize: 11 }}>
              {audioVariant === "processed" ? "processed" : "raw"}
            </strong>
          </summary>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <a className="downloadLink" href={buildExtendedUrl("script", "json")} target="_blank" rel="noreferrer">剧本 JSON</a>
            <a className="downloadLink" href={buildExtendedUrl("script", "csv")} target="_blank" rel="noreferrer">剧本 CSV</a>
            <a className="downloadLink" href={buildExtendedUrl("timestamp_manifest", "json")} target="_blank" rel="noreferrer">时间戳 JSON</a>
            <a className="downloadLink" href={buildExtendedUrl("timestamp_manifest", "csv")} target="_blank" rel="noreferrer">时间戳 CSV</a>
            <a className="downloadLink" href={buildExtendedUrl("chapters", "json")} target="_blank" rel="noreferrer">章节清单 JSON</a>
            <a className="downloadLink" href={buildExtendedUrl("chapters", "csv")} target="_blank" rel="noreferrer">章节清单 CSV</a>
            <a className="downloadLink" href={buildExtendedUrl("metadata", "json", "podcast")} target="_blank" rel="noreferrer">播客元数据</a>
            <a className="downloadLink" href={buildExtendedUrl("metadata", "json", "audible")} target="_blank" rel="noreferrer">Audible 元数据</a>
            <a className="downloadLink" href={buildExtendedUrl("ffmetadata", "txt")} target="_blank" rel="noreferrer">FFMetadata</a>
            <a className="downloadLink" href={buildExtendedUrl("capcut", "csv")} target="_blank" rel="noreferrer">剪映 CSV</a>
            <a className="downloadLink" href={buildExtendedUrl("premiere_markers", "csv")} target="_blank" rel="noreferrer">PR 标记 CSV</a>
          </div>
        </details>
      ) : null}
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
          播放后期处理
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
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          disabled={!hasProject}
          onClick={onOpenExportWizard}
        >
          导出向导
        </Button>
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
