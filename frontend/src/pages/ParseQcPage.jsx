import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import EmptyState from "../components/shared/EmptyState";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { formatError } from "../utils/errors";

const QC_FOCUS_SEGMENTS_KEY = "beautyvoice.qc.focus_segments";
const QC_FOCUS_SEGMENT_LEGACY_KEY = "beautyvoice.qc.focus_segment_id";

function severityTone(severity) {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "default";
}

function normalizeSeverity(value) {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
}

function severityRank(value) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function extractIssueSegmentIds(issue) {
  const ids = [];
  const directIds = Array.isArray(issue?.segment_ids) ? issue.segment_ids : [];
  for (const id of directIds) {
    const normalized = String(id || "").trim();
    if (normalized) {
      ids.push(normalized);
    }
  }
  const evidenceItems = Array.isArray(issue?.evidence?.items) ? issue.evidence.items : [];
  for (const item of evidenceItems) {
    const normalized = String(item?.segment_id || "").trim();
    if (normalized) {
      ids.push(normalized);
    }
  }
  return Array.from(new Set(ids));
}

export default function ParseQcPage({ onNavigate }) {
  const { currentProject, parseQcReport, loadProjectParseQc } = useProjectStore();
  const scriptSegments = useScriptStore((state) => state.script?.segments || []);
  const loadProjectScript = useScriptStore((state) => state.loadProjectScript);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReport() {
    if (!currentProject?.id) return;
    setIsLoading(true);
    setError("");
    try {
      await loadProjectParseQc(currentProject.id);
    } catch (err) {
      setError(formatError("质检加载失败", err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!currentProject?.id) {
      return;
    }
    loadReport().catch(() => undefined);
    loadProjectScript(currentProject.id).catch(() => undefined);
  }, [currentProject?.id]);

  const summary = parseQcReport?.summary || {};
  const metrics = parseQcReport?.metrics || {};
  const issues = useMemo(() => (Array.isArray(parseQcReport?.issues) ? parseQcReport.issues : []), [parseQcReport?.issues]);
  const segmentNumberById = useMemo(() => {
    const next = new Map();
    (scriptSegments || []).forEach((segment, idx) => {
      const id = String(segment?.id || "").trim();
      if (!id) {
        return;
      }
      next.set(id, Number(segment?.index ?? idx) + 1);
    });
    return next;
  }, [scriptSegments]);
  const highlightBySegmentId = useMemo(() => {
    const next = {};
    issues.forEach((issue) => {
      const severity = normalizeSeverity(issue?.severity);
      extractIssueSegmentIds(issue).forEach((segmentId) => {
        const current = normalizeSeverity(next[segmentId]);
        if (!next[segmentId] || severityRank(severity) > severityRank(current)) {
          next[segmentId] = severity;
        }
      });
    });
    return next;
  }, [issues]);

  function formatSegmentTag(segmentId) {
    const normalized = String(segmentId || "").trim();
    if (!normalized) {
      return "#?";
    }
    const number = segmentNumberById.get(normalized);
    return number ? `#${number}` : "#?";
  }

  function formatSegmentList(segmentIds, limit = 6) {
    const list = Array.from(new Set((segmentIds || []).map((item) => String(item || "").trim()).filter(Boolean)));
    if (!list.length) {
      return "";
    }
    const labels = list.slice(0, limit).map((segmentId) => formatSegmentTag(segmentId));
    return `${labels.join(", ")}${list.length > limit ? " ..." : ""}`;
  }

  function jumpToIssue(issue, preferredSegmentId = "") {
    const issueSegmentIds = extractIssueSegmentIds(issue);
    const preferred = String(preferredSegmentId || "").trim();
    const focusedIds = preferred
      ? Array.from(new Set([preferred, ...issueSegmentIds]))
      : issueSegmentIds;
    if (!focusedIds.length) {
      return;
    }
    const payload = {
      focus_segment_id: focusedIds[0],
      focus_segment_ids: focusedIds,
      highlight_by_segment_id: highlightBySegmentId,
      timestamp: Date.now(),
    };
    window.sessionStorage.setItem(QC_FOCUS_SEGMENTS_KEY, JSON.stringify(payload));
    window.sessionStorage.setItem(QC_FOCUS_SEGMENT_LEGACY_KEY, focusedIds[0]);
    onNavigate?.("script");
  }

  return (
    <div className="pageGrid" style={{ gap: 16 }}>
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">
              <ShieldCheck size={16} />
              解析质检
            </h2>
            <p className="cardSubtitle">规则告警不会阻断流程，可直接跳转到对应片段处理。</p>
          </div>
          <Button variant="secondary" onClick={() => loadReport()} disabled={isLoading} icon={RefreshCw}>
            {isLoading ? "刷新中..." : "刷新"}
          </Button>
        </div>
        {!currentProject?.id ? (
          <EmptyState title="请先选择项目" description="回到文本输入页解析后再查看质检结果。" />
        ) : (
          <div className="controlRow" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="statusBadge default">问题 {summary.issue_count ?? 0}</span>
            <span className="statusBadge error">高 {summary.high_count ?? 0}</span>
            <span className="statusBadge warning">中 {summary.medium_count ?? 0}</span>
            <span className="statusBadge default">低 {summary.low_count ?? 0}</span>
            <span className="statusBadge default">覆盖率 {(Number(summary.coverage_ratio ?? 0) * 100).toFixed(1)}%</span>
          </div>
        )}
        {error ? <div className="errorText">{error}</div> : null}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">指标</h2>
        <div className="listStack">
          <div className="statRow"><span>原文字符</span><strong>{metrics.source_char_count ?? 0}</strong></div>
          <div className="statRow"><span>片段数</span><strong>{metrics.segment_count ?? 0}</strong></div>
          <div className="statRow"><span>疑似漏段</span><strong>{metrics.coverage_missing_count ?? 0}</strong></div>
          <div className="statRow"><span>顺序异常</span><strong>{metrics.coverage_out_of_order_count ?? 0}</strong></div>
          <div className="statRow"><span>角色变体组</span><strong>{metrics.character_variant_group_count ?? 0}</strong></div>
          <div className="statRow"><span>超长片段</span><strong>{metrics.long_segment_count ?? 0}</strong></div>
          <div className="statRow"><span>重复组</span><strong>{metrics.duplicate_group_count ?? 0}</strong></div>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">
          <AlertTriangle size={16} />
          告警列表
        </h2>
        {!issues.length ? (
          <EmptyState title="暂无告警" description="当前规则未发现显著风险。" />
        ) : (
          <div className="listStack">
            {issues.map((issue) => {
              const segmentIds = extractIssueSegmentIds(issue);
              const missingItems = issue?.type === "coverage_missing" && Array.isArray(issue?.evidence?.items)
                ? issue.evidence.items
                : [];
              return (
                <div key={issue.id} className="statRow" style={{ alignItems: "flex-start", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                    <div className="controlRow" style={{ gap: 8, flexWrap: "wrap" }}>
                      <strong>{issue.title || issue.type}</strong>
                      <span className={`statusBadge ${severityTone(issue.severity)}`}>{issue.severity || "low"}</span>
                    </div>
                    <span className="muted" style={{ wordBreak: "break-word" }}>{issue.description || ""}</span>
                    {segmentIds.length ? <span className="muted">涉及片段：{formatSegmentList(segmentIds, 6)}</span> : null}
                    {missingItems.length ? (
                      <div className="listStack" style={{ marginTop: 6 }}>
                        {missingItems.slice(0, 4).map((item) => (
                          <div key={`${issue.id}-${item.segment_id}`} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 8 }}>
                            <div className="controlRow" style={{ justifyContent: "space-between", gap: 8 }}>
                              <strong style={{ fontSize: 12 }}>片段 {formatSegmentTag(item.segment_id)}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>相似度 {(Number(item.similarity || 0) * 100).toFixed(1)}%</span>
                            </div>
                            {item.before_context ? <div className="muted" style={{ fontSize: 12 }}>前文：{item.before_context}</div> : null}
                            <div className="muted" style={{ fontSize: 12 }}>片段：{item.segment_text || "-"}</div>
                            {item.after_context ? <div className="muted" style={{ fontSize: 12 }}>后文：{item.after_context}</div> : null}
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              <div className="muted">候选原文：{item.source_candidate || "（未找到近似句）"}</div>
                              {item.source_diff ? <pre className="codeBlock" style={{ marginTop: 4 }}>原文 diff: {item.source_diff}</pre> : null}
                              {item.segment_diff ? <pre className="codeBlock" style={{ marginTop: 4 }}>片段 diff: {item.segment_diff}</pre> : null}
                            </div>
                            <div className="controlRow" style={{ marginTop: 6 }}>
                              <Button variant="secondary" size="sm" onClick={() => jumpToIssue(issue, item.segment_id)}>
                                定位此片段
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {segmentIds[0] ? (
                    <Button variant="secondary" size="sm" onClick={() => jumpToIssue(issue)}>
                      定位片段
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
