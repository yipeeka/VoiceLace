import { useMemo } from "react";
import { useI18n } from "../../i18n/I18nProvider";

export default function ProgressTracker({ status, progress, modelStatus, taskId }) {
  const { t } = useI18n();
  const statusKey = status === "cancel_requested" ? "cancelRequested" : status;
  const percent = useMemo(() => {
    if (!progress?.total) {
      return 0;
    }
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  }, [progress]);

  return (
    <div className="progressTracker">
      <div className="segmentEditorHeader">
        <strong>{t("synth.status.progress")}</strong>
        <span className={`taskStatusBadge status-${status}`}>{t(`music.status.${statusKey}`) || status}</span>
      </div>
      <div className="progressBarShell" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="progressBarFill" style={{ width: `${percent}%` }} />
      </div>
      <div className="statRow">
        <span>{t("synth.progress.completion")}</span>
        <strong>
          {progress.current}/{progress.total} ({percent}%)
        </strong>
      </div>
      <div className="statRow">
        <span>{t("synth.progress.modelStatus")}</span>
        <strong>{modelStatus || "--"}</strong>
      </div>
      <div className="statRow">
        <span>{t("music.runtime.taskId")}</span>
        <strong>{taskId || "--"}</strong>
      </div>
    </div>
  );
}
