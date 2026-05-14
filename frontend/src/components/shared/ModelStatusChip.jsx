import { cn } from "../../utils/cn";
import { useI18n } from "../../i18n/I18nProvider";

const STATUS_CONFIG = {
  idle:      { dot: "idle",    key: "status.state.idle" },
  loading:   { dot: "loading", key: "status.state.loading" },
  ready:     { dot: "ready",   key: "status.state.ready" },
  running:   { dot: "loading", key: "legacy.status.state.running" },
  unloading: { dot: "loading", key: "status.state.unloading" },
  error:     { dot: "error",   key: "status.state.error" },
};

export default function ModelStatusChip({ name, status = "idle", className }) {
  const { t } = useI18n();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  return (
    <div
      className={cn("statusBarItem", className)}
      style={{ gap: 8, display: "flex", alignItems: "center" }}
    >
      <span className={cn("statusBarDot", config.dot)} />
      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{name}:</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 500 }}>
        {t(config.key)}
      </span>
    </div>
  );
}
