import { ChevronDown, ChevronUp, History, RefreshCw, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nProvider";

function formatTimestamp(raw) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

export default function ProjectHistoryCard({
  projectName,
  historyItems,
  isLoading,
  onRefresh,
  onRollback,
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => (Array.isArray(historyItems) ? historyItems : []), [historyItems]);

  return (
    <GlassCard className="fullWidthCard">
      <div className="sectionHeader">
        <div className="sectionHeaderLeft">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: "flex-start", paddingLeft: 0, paddingRight: 0 }}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <History size={16} />
            {t("text.history.title")}
          </button>
          <p className="cardSubtitle">
            {expanded
              ? t("text.history.subtitleExpanded")
              : t("text.history.subtitleCollapsed")}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRefresh} disabled={isLoading}>
          {isLoading ? t("common.refreshing") : t("common.refresh")}
        </Button>
      </div>

      {!expanded ? (
        <div className="muted">{t("text.history.collapsed")}</div>
      ) : !projectName ? (
        <div className="emptyState">{t("text.history.selectProjectFirst")}</div>
      ) : rows.length === 0 ? (
        <div className="emptyState">{t("text.history.empty")}</div>
      ) : (
        <div className="listStack">
          {rows.map((item) => {
            const isSnapshot = item?.kind === "snapshot" && item?.snapshot?.id;
            const desc = item?.description || "";
            return (
              <div key={item.id} className="statRow" style={{ alignItems: "flex-start", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <strong>{item?.title || t("text.history.record")}</strong>
                    <span className="muted">{formatTimestamp(item?.timestamp)}</span>
                    {item?.event?.source ? <span className="projectToolbarBadge">{item.event.source}</span> : null}
                    {isSnapshot ? <span className="projectToolbarBadge">{t("text.history.snapshot")}</span> : null}
                  </div>
                  {desc ? <span className="muted" style={{ wordBreak: "break-word" }}>{desc}</span> : null}
                </div>
                {isSnapshot ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={RotateCcw}
                    onClick={() => onRollback(item.snapshot.id)}
                    title={t("text.history.rollbackToSnapshot")}
                  >
                    {t("text.history.rollback")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
