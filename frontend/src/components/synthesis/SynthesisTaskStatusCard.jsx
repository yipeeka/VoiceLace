import { Download, Upload } from "lucide-react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Progress from "../ui/Progress";
import { useI18n } from "../../i18n/I18nProvider";

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
  const { t } = useI18n();
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
      <h2 className="cardTitle">{t("synth.status.title")}</h2>
      {staleReport && (staleReport.stale_count > 0 || staleReport.missing_count > 0) ? (
        <div className="statusBadge warning" style={{ marginBottom: 8 }}>
          {t("synth.status.staleSummary", { total: staleReport.total, modified: staleSummary.modified, config: staleSummary.config })}{" "}
          {t("synth.status.segmentsCount", { count: staleSummary.missing })}
        </div>
      ) : null}
      <div className="taskStatusGrid">
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.state")}</span>
          <strong>{modelStatus || status}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.connection")}</span>
          <strong>{connectionStatus}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.progress")}</span>
          <strong style={{ fontFamily: "monospace" }}>
            {progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}
          </strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.queuePosition")}</span>
          <strong>{queuePosition > 0 ? `#${queuePosition}` : t("synth.status.runningOrIdle")}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.queueLength")}</span>
          <strong>{queuedCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.failedSegments")}</span>
          <strong>{failedCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.retryCount")}</span>
          <strong>{retryCount}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.segmentConcurrency")}</span>
          <strong>{effectiveSegmentConcurrency}</strong>
        </div>
        <div className="statRow taskStatusCell taskStatusCellWide">
          <span>{t("synth.status.model")}</span>
          <strong>TTS {runtimeStatus?.tts_loaded ? t("synth.status.loaded") : t("synth.status.unloaded")} / LLM {runtimeStatus?.llm_loaded ? t("synth.status.loaded") : t("synth.status.unloaded")}</strong>
        </div>
        <div className="statRow taskStatusCell">
          <span>{t("synth.status.vram")}</span>
          <strong>
            App {gpu.process_used_vram_mb ?? gpu.torch_reserved_mb ?? 0} MB / GPU {gpu.system_used_vram_mb ?? gpu.used_vram_mb ?? 0} MB
          </strong>
        </div>
        <div className="statRow taskStatusCell taskStatusCellWide">
          <span>{t("synth.status.taskId")}</span>
          <strong style={{ fontFamily: "monospace", fontSize: 11 }}>{taskId || "—"}</strong>
        </div>
      </div>
      {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
      {(isRunning || status !== "idle") && (
        <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
      )}
      <div className="controlRow" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" disabled={!canResume} onClick={onResume}>
          {t("synth.status.resume")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canRetryFailed} onClick={onRetryFailed}>
          {t("synth.status.retryFailedOnly")}
        </Button>
        <Button variant="danger" size="sm" disabled={!canCancelQueued} onClick={onCancelTask}>
          {status === "queued" ? t("synth.status.cancelQueue") : t("synth.status.stopTask")}
        </Button>
      </div>
      {fullAudioUrl && (
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <a className="downloadLink" href={fullAudioUrl} target="_blank" rel="noreferrer">
            <Download size={14} />
            {t("synth.status.downloadCurrent")}
          </a>
          {rawAudioUrl ? (
            <a className="downloadLink" href={rawAudioUrl} target="_blank" rel="noreferrer">
              {t("synth.status.downloadRaw")}
            </a>
          ) : null}
          {processedAudioUrl ? (
            <a className="downloadLink" href={processedAudioUrl} target="_blank" rel="noreferrer">
              {t("synth.status.downloadProcessed")}
            </a>
          ) : null}
          {subtitleSrtUrl ? (
            <a className="downloadLink" href={subtitleSrtUrl} target="_blank" rel="noreferrer">
              {t("synth.status.downloadSrt")}
            </a>
          ) : null}
          {subtitleLrcUrl ? (
            <a className="downloadLink" href={subtitleLrcUrl} target="_blank" rel="noreferrer">
              {t("synth.status.downloadLrc")}
            </a>
          ) : null}
          {currentProject?.id ? (
            <a
              className="downloadLink"
              href={`${API_ORIGIN}/api/v1/tts/export/${currentProject.id}/archive`}
              target="_blank"
              rel="noreferrer"
            >
              {t("synth.status.downloadProjectZip")}
            </a>
          ) : null}
        </div>
      )}
      {hasProject ? (
        <details className="listStack" style={{ marginTop: 8 }}>
          <summary className="statRow" style={{ cursor: "pointer", listStyle: "none" }}>
            <span>{t("synth.status.extendedExport")}</span>
            <strong style={{ fontFamily: "monospace", fontSize: 11 }}>
              {audioVariant === "processed" ? "processed" : "raw"}
            </strong>
          </summary>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <a className="downloadLink" href={buildExtendedUrl("script", "json")} target="_blank" rel="noreferrer">{t("synth.status.extended.scriptJson")}</a>
            <a className="downloadLink" href={buildExtendedUrl("script", "csv")} target="_blank" rel="noreferrer">{t("synth.status.extended.scriptCsv")}</a>
            <a className="downloadLink" href={buildExtendedUrl("timestamp_manifest", "json")} target="_blank" rel="noreferrer">{t("synth.status.extended.timestampJson")}</a>
            <a className="downloadLink" href={buildExtendedUrl("timestamp_manifest", "csv")} target="_blank" rel="noreferrer">{t("synth.status.extended.timestampCsv")}</a>
            <a className="downloadLink" href={buildExtendedUrl("chapters", "json")} target="_blank" rel="noreferrer">{t("synth.status.extended.chaptersJson")}</a>
            <a className="downloadLink" href={buildExtendedUrl("chapters", "csv")} target="_blank" rel="noreferrer">{t("synth.status.extended.chaptersCsv")}</a>
            <a className="downloadLink" href={buildExtendedUrl("metadata", "json", "podcast")} target="_blank" rel="noreferrer">{t("synth.status.extended.podcastMetadata")}</a>
            <a className="downloadLink" href={buildExtendedUrl("metadata", "json", "audible")} target="_blank" rel="noreferrer">{t("synth.status.extended.audibleMetadata")}</a>
            <a className="downloadLink" href={buildExtendedUrl("ffmetadata", "txt")} target="_blank" rel="noreferrer">{t("synth.status.extended.ffmetadata")}</a>
            <a className="downloadLink" href={buildExtendedUrl("capcut", "csv")} target="_blank" rel="noreferrer">{t("synth.status.extended.capcutCsv")}</a>
            <a className="downloadLink" href={buildExtendedUrl("premiere_markers", "csv")} target="_blank" rel="noreferrer">{t("synth.status.extended.prMarkersCsv")}</a>
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
          {t("synth.status.playRaw")}
        </Button>
        <Button
          variant={audioVariant === "processed" ? "primary" : "secondary"}
          size="sm"
          disabled={!processedAudioUrl}
          onClick={() => onAudioVariantChange?.("processed")}
        >
          {t("synth.status.playProcessed")}
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
          {t("synth.status.exportWizard")}
        </Button>
        <Button variant="secondary" size="sm" icon={Upload} onClick={() => archiveInputRef.current?.click()}>
          {t("synth.status.importProjectZip")}
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
            <div key={`${idx}-${warning}`}>{t("text.importHint")} {idx + 1}: {warning}</div>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}
