import { ChevronDown, ChevronUp, History, RefreshCw, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";

function formatTimestamp(raw) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function ProjectHistoryCard({
  projectName,
  historyItems,
  isLoading,
  onRefresh,
  onRollback,
}) {
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
            项目历史
          </button>
          <p className="cardSubtitle">
            {expanded
              ? "显示快照与关键任务事件，可回滚到历史版本。"
              : "默认收起，点击“项目历史”展开。"}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "刷新中..." : "刷新"}
        </Button>
      </div>

      {!expanded ? (
        <div className="muted">已收起</div>
      ) : !projectName ? (
        <div className="emptyState">请先选择项目。</div>
      ) : rows.length === 0 ? (
        <div className="emptyState">暂无历史记录。</div>
      ) : (
        <div className="listStack">
          {rows.map((item) => {
            const isSnapshot = item?.kind === "snapshot" && item?.snapshot?.id;
            const desc = item?.description || "";
            return (
              <div key={item.id} className="statRow" style={{ alignItems: "flex-start", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <strong>{item?.title || "历史记录"}</strong>
                    <span className="muted">{formatTimestamp(item?.timestamp)}</span>
                    {item?.event?.source ? <span className="projectToolbarBadge">{item.event.source}</span> : null}
                    {isSnapshot ? <span className="projectToolbarBadge">snapshot</span> : null}
                  </div>
                  {desc ? <span className="muted" style={{ wordBreak: "break-word" }}>{desc}</span> : null}
                </div>
                {isSnapshot ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={RotateCcw}
                    onClick={() => onRollback(item.snapshot.id)}
                    title="回滚到此快照"
                  >
                    回滚
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
