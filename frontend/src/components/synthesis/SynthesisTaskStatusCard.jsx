import { ChevronDown, ChevronUp, Download, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Progress from "../ui/Progress";

export function SynthesisTaskStatusStrip({
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
  onRetryFailed,
  onResume,
  onCancelTask,
}) {
  const gpu = runtimeStatus?.gpu || {};
  const queuedCount = Number(queueSnapshot?.queued_count || 0);
  const effectiveStatus = modelStatus || status;
  const isActive = isRunning || status === "queued" || status === "cancel_requested";
  const showProgress = isActive || status === "done" || status === "error";
  const canResume = !isRunning && (failedCount > 0 || staleReport?.missing_count > 0 || staleReport?.stale_count > 0);
  const canRetryFailed = !isRunning && failedCount > 0;
  const canCancelQueued = status === "queued" || status === "cancel_requested" || isRunning;
  const showActions = canResume || canRetryFailed || canCancelQueued;
  const [showRuntimeDetails, setShowRuntimeDetails] = useState(false);

  return (
    <GlassCard className={`synthesisTaskStatusStrip ${isActive ? "active" : ""}`.trim()}>
      <div className="taskStatusStripPrimary">
        <div className="taskStatusStripTitle">
          <span className={`taskStatusDot ${isActive ? "running" : status === "error" ? "error" : "idle"}`} aria-hidden="true" />
          <strong>任务状态</strong>
        </div>
        <div className="taskStatusStripMetrics" aria-live="polite">
          <span>
            状态 <strong>{effectiveStatus}</strong>
          </span>
          <span>
            连接 <strong>{connectionStatus}</strong>
          </span>
          <span>
            队列 <strong>{queuedCount}</strong>
          </span>
          {queuePosition > 0 ? (
            <span>
              排队 <strong>#{queuePosition}</strong>
            </span>
          ) : null}
          {showProgress ? (
            <span>
              进度{" "}
              <strong style={{ fontFamily: "monospace" }}>
                {progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}
              </strong>
            </span>
          ) : null}
          {failedCount > 0 ? (
            <span className="warning">
              失败 <strong>{failedCount}</strong>
            </span>
          ) : null}
        </div>
        <button
          className="taskStatusStripDetailsToggle"
          type="button"
          aria-expanded={showRuntimeDetails}
          onClick={() => setShowRuntimeDetails((current) => !current)}
        >
          {showRuntimeDetails ? "收起详情" : "运行详情"}
        </button>
        {showActions ? (
          <div className="taskStatusStripActions">
            {canResume ? (
              <Button variant="secondary" size="sm" onClick={onResume}>
                继续合成
              </Button>
            ) : null}
            {canRetryFailed ? (
              <Button variant="secondary" size="sm" onClick={onRetryFailed}>
                只重试失败段
              </Button>
            ) : null}
            {canCancelQueued ? (
              <Button variant="danger" size="sm" onClick={onCancelTask}>
                {status === "queued" ? "取消排队" : "停止任务"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {showRuntimeDetails ? (
        <div className="taskStatusStripDetailsGrid">
          <span>重试 <strong>{retryCount}</strong></span>
          <span>段并发 <strong>{effectiveSegmentConcurrency}</strong></span>
          <span>TTS <strong>{runtimeStatus?.tts_loaded ? "已加载" : "未加载"}</strong></span>
          <span>LLM <strong>{runtimeStatus?.llm_loaded ? "已加载" : "未加载"}</strong></span>
          <span className="taskStatusStripDetailWide">
            显存 <strong>App {gpu.process_used_vram_mb ?? gpu.torch_reserved_mb ?? 0} MB / GPU {gpu.system_used_vram_mb ?? gpu.used_vram_mb ?? 0} MB</strong>
          </span>
          <span className="taskStatusStripDetailWide">
            Task ID <strong>{taskId || "—"}</strong>
          </span>
        </div>
      ) : null}
      {showProgress ? (
        <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
      ) : null}
      {staleReport && (staleReport.stale_count > 0 || staleReport.missing_count > 0) ? (
        <div className="taskStatusStripWarning">
          共 {staleReport.total} 段，其中已修改 {staleSummary.modified} 段，配置变化 {staleSummary.config} 段，缺失{" "}
          {staleSummary.missing} 段
        </div>
      ) : null}
      {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
    </GlassCard>
  );
}

export default function SynthesisTaskStatusCard({
  expanded = true,
  onToggle,
  API_ORIGIN,
  fullAudioUrl,
  rawAudioUrl,
  processedAudioUrl,
  chapterExports = [],
  audioVariant = "raw",
  subtitleSrtUrl,
  subtitleLrcUrl,
  currentProject,
  importWarnings,
  archiveInputRef,
  onImportArchive,
  onOpenExportWizard,
}) {
  const normalizedChapterExports = useMemo(
    () => (Array.isArray(chapterExports) ? chapterExports : []),
    [chapterExports],
  );
  const chapterExportIds = useMemo(
    () => normalizedChapterExports.map((chapter, index) => String(chapter?.id || `chapter-${index + 1}`)),
    [normalizedChapterExports],
  );
  const [selectedChapterIds, setSelectedChapterIds] = useState(chapterExportIds);
  const projectId = currentProject?.id || "";
  const hasProject = Boolean(projectId);
  const buildExtendedUrl = (kind, format = "json", profile = "podcast") => (
    `${API_ORIGIN}/api/v1/tts/export/extended?project_id=${projectId}&kind=${encodeURIComponent(kind)}&format=${encodeURIComponent(format)}&variant=${encodeURIComponent(audioVariant || "raw")}&profile=${encodeURIComponent(profile)}`
  );

  useEffect(() => {
    setSelectedChapterIds(chapterExportIds);
  }, [chapterExportIds]);

  const selectedChapterIdSet = new Set(selectedChapterIds);
  const allChaptersSelected = chapterExportIds.length > 0 && selectedChapterIds.length === chapterExportIds.length;

  function toggleAllChapters(checked) {
    setSelectedChapterIds(checked ? chapterExportIds : []);
  }

  function toggleChapter(chapterId, checked) {
    setSelectedChapterIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(chapterId);
      } else {
        next.delete(chapterId);
      }
      return chapterExportIds.filter((id) => next.has(id));
    });
  }

  return (
    <GlassCard className="synthesisConsolePanel synthesisExportDrawer">
      <div className="sectionHeader synthesisConsoleHeader synthesisExportHeader">
        <div className="sectionHeaderLeft">
          <button
            type="button"
            className="btn btn-ghost btn-sm synthesisConsoleTitleButton"
            style={{ justifyContent: "flex-start", paddingLeft: 0, paddingRight: 0 }}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp aria-hidden="true" focusable="false" size={14} /> : <ChevronDown aria-hidden="true" focusable="false" size={14} />}
            导出中心
          </button>
          <p className="cardSubtitle">{expanded ? "音频、字幕、章节与工程归档" : "已收起，点击展开。"}</p>
        </div>
      </div>
      {!expanded ? (
        <div className="muted">已收起</div>
      ) : (
        <>
      {fullAudioUrl ? (
        <div className="synthesisExportContentGrid">
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
      ) : (
        <div className="muted">完成整本合成后可下载音频、字幕和工程归档。</div>
      )}
      {hasProject ? (
        <details className="listStack synthesisExportExtended" style={{ marginTop: 8 }}>
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
      {normalizedChapterExports.length ? (
        <div className="listStack synthesisChapterExportList" style={{ marginTop: 8 }}>
          <label className="statRow synthesisChapterExportSelectAll">
            <input
              type="checkbox"
              checked={allChaptersSelected}
              onChange={(event) => toggleAllChapters(event.target.checked)}
            />
            <span>全选章节</span>
            <strong>{selectedChapterIds.length}/{chapterExportIds.length}</strong>
          </label>
          {normalizedChapterExports.map((chapter, index) => {
            const chapterId = String(chapter?.id || `chapter-${index + 1}`);
            const selected = selectedChapterIdSet.has(chapterId);
            return (
              <div key={chapterId} className={`statRow synthesisChapterExportRow ${selected ? "selected" : ""}`} style={{ gap: 8, alignItems: "center" }}>
                <label className="synthesisChapterExportCheck">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => toggleChapter(chapterId, event.target.checked)}
                  />
                  <span title={chapter.title || chapterId}>{chapter.title || chapterId}</span>
                </label>
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
            );
          })}
        </div>
      ) : null}
      <div className="controlRow synthesisExportMainActions" style={{ marginTop: 10 }}>
        <Button
          variant="primary"
          size="lg"
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
          name="project-archive"
          aria-label="导入工程 ZIP"
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
        </>
      )}
    </GlassCard>
  );
}
