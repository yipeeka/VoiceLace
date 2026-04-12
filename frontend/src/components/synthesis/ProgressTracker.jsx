import { useMemo } from "react";

const STATUS_LABELS = {
  idle: "空闲",
  queued: "排队中",
  running: "合成中",
  cancel_requested: "取消中",
  canceled: "已取消",
  done: "已完成",
  error: "失败",
};

export default function ProgressTracker({ status, progress, modelStatus, taskId }) {
  const percent = useMemo(() => {
    if (!progress?.total) {
      return 0;
    }
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  }, [progress]);

  return (
    <div className="progressTracker">
      <div className="segmentEditorHeader">
        <strong>任务进度</strong>
        <span className={`taskStatusBadge status-${status}`}>{STATUS_LABELS[status] || status}</span>
      </div>
      <div className="progressBarShell" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="progressBarFill" style={{ width: `${percent}%` }} />
      </div>
      <div className="statRow">
        <span>完成度</span>
        <strong>
          {progress.current}/{progress.total} ({percent}%)
        </strong>
      </div>
      <div className="statRow">
        <span>模型状态</span>
        <strong>{modelStatus || "--"}</strong>
      </div>
      <div className="statRow">
        <span>任务 ID</span>
        <strong>{taskId || "--"}</strong>
      </div>
    </div>
  );
}
