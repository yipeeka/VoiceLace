import { cn } from "../../utils/cn";

const STATUS_CONFIG = {
  idle:      { dot: "idle",    label: "空闲" },
  loading:   { dot: "loading", label: "加载中" },
  ready:     { dot: "ready",   label: "就绪" },
  running:   { dot: "loading", label: "运行中" },
  unloading: { dot: "loading", label: "卸载中" },
  error:     { dot: "error",   label: "错误" },
};

export default function ModelStatusChip({ name, status = "idle", className }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  return (
    <div
      className={cn("statusBarItem", className)}
      style={{ gap: 8, display: "flex", alignItems: "center" }}
    >
      <span className={cn("statusBarDot", config.dot)} />
      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{name}:</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 500 }}>
        {config.label}
      </span>
    </div>
  );
}
