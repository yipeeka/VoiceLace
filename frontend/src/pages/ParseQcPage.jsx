import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import GlassCard from "../components/shared/GlassCard";
import EmptyState from "../components/shared/EmptyState";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { formatError } from "../utils/errors";
import { useI18n } from "../i18n/I18nProvider";

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

function resolveIssueTitle(issue, t) {
  const type = String(issue?.type || "").trim();
  if (type === "coverage_missing") return t("qc.issueType.coverageMissing");
  if (type === "coverage_out_of_order") return t("qc.issueType.coverageOutOfOrder");
  if (type === "character_variant_groups") return t("qc.issueType.characterVariantGroups");
  if (type === "long_segment") return t("qc.issueType.longSegment");
  if (type === "duplicate_group") return t("qc.issueType.duplicateGroup");
  if (type === "possible_missing_segments") return t("qc.issueType.coverageMissing");
  return issue?.title || issue?.type || "-";
}

export default function ParseQcPage({ onNavigate }) {
  const { t, language } = useI18n();
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
      setError(formatError(t("qc.loadFailed"), err));
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

  function localizeIssueDescription(value) {
    const raw = String(value || "");
    if (!raw) return "";
    if (language === "zh") {
      return raw
        .replace(/^Possible missing segments$/i, t("qc.issueType.coverageMissing"))
        .replace(/^Involved segments:/i, t("qc.issueList.involvedSegments"))
        .replace(/\bHigh\b/g, t("qc.badge.high"))
        .replace(/\bMedium\b/g, t("qc.badge.medium"))
        .replace(/\bLow\b/g, t("qc.badge.low"));
    }
    return raw;
  }

  return (
    <div className="pageGrid" style={{ gap: 16 }}>
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">
              <ShieldCheck size={16} />
              {t("qc.title")}
            </h2>
            <p className="cardSubtitle">{t("qc.subtitle")}</p>
          </div>
          <Button variant="secondary" onClick={() => loadReport()} disabled={isLoading} icon={RefreshCw}>
            {isLoading ? t("common.refreshing") : t("common.refresh")}
          </Button>
        </div>
        {!currentProject?.id ? (
          <EmptyState title={t("qc.empty.selectProjectTitle")} description={t("qc.empty.selectProjectDesc")} />
        ) : (
          <div className="controlRow" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="statusBadge default">{t("qc.badge.issues")} {summary.issue_count ?? 0}</span>
            <span className="statusBadge error">{t("qc.badge.high")} {summary.high_count ?? 0}</span>
            <span className="statusBadge warning">{t("qc.badge.medium")} {summary.medium_count ?? 0}</span>
            <span className="statusBadge default">{t("qc.badge.low")} {summary.low_count ?? 0}</span>
            <span className="statusBadge default">{t("qc.badge.coverage")} {(Number(summary.coverage_ratio ?? 0) * 100).toFixed(1)}%</span>
          </div>
        )}
        {error ? <div className="errorText">{error}</div> : null}
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">{t("qc.metrics.title")}</h2>
        <div className="listStack">
          <div className="statRow"><span>{t("qc.metrics.sourceChars")}</span><strong>{metrics.source_char_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.segmentCount")}</span><strong>{metrics.segment_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.missing")}</span><strong>{metrics.coverage_missing_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.orderAnomaly")}</span><strong>{metrics.coverage_out_of_order_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.variantGroups")}</span><strong>{metrics.character_variant_group_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.overlong")}</span><strong>{metrics.long_segment_count ?? 0}</strong></div>
          <div className="statRow"><span>{t("qc.metrics.duplicateGroups")}</span><strong>{metrics.duplicate_group_count ?? 0}</strong></div>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="cardTitle">
          <AlertTriangle size={16} />
          {t("qc.issueList.title")}
        </h2>
        {!issues.length ? (
          <EmptyState title={t("qc.issueList.emptyTitle")} description={t("qc.issueList.emptyDesc")} />
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
                      <strong>{resolveIssueTitle(issue, t)}</strong>
                      <span className={`statusBadge ${severityTone(issue.severity)}`}>
                        {normalizeSeverity(issue.severity) === "high"
                          ? t("qc.badge.high")
                          : normalizeSeverity(issue.severity) === "medium"
                            ? t("qc.badge.medium")
                            : t("qc.badge.low")}
                      </span>
                    </div>
                    <span className="muted" style={{ wordBreak: "break-word" }}>{localizeIssueDescription(issue.description || "")}</span>
                    {segmentIds.length ? <span className="muted">{t("qc.issueList.involvedSegments")} {formatSegmentList(segmentIds, 6)}</span> : null}
                    {missingItems.length ? (
                      <div className="listStack" style={{ marginTop: 6 }}>
                        {missingItems.slice(0, 4).map((item) => (
                          <div key={`${issue.id}-${item.segment_id}`} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 8 }}>
                            <div className="controlRow" style={{ justifyContent: "space-between", gap: 8 }}>
                              <strong style={{ fontSize: 12 }}>{t("qc.issueList.segment")} {formatSegmentTag(item.segment_id)}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>{t("qc.issueList.similarity")} {(Number(item.similarity || 0) * 100).toFixed(1)}%</span>
                            </div>
                            {item.before_context ? <div className="muted" style={{ fontSize: 12 }}>{t("qc.issueList.contextBefore")} {item.before_context}</div> : null}
                            <div className="muted" style={{ fontSize: 12 }}>{t("qc.issueList.segment")} {item.segment_text || "-"}</div>
                            {item.after_context ? <div className="muted" style={{ fontSize: 12 }}>{t("qc.issueList.contextAfter")} {item.after_context}</div> : null}
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              <div className="muted">{t("qc.issueList.sourceCandidate")} {item.source_candidate || t("qc.issueList.noSimilarSentence")}</div>
                              {item.source_diff ? <pre className="codeBlock" style={{ marginTop: 4 }}>{t("qc.issueList.sourceDiff")} {item.source_diff}</pre> : null}
                              {item.segment_diff ? <pre className="codeBlock" style={{ marginTop: 4 }}>{t("qc.issueList.segmentDiff")} {item.segment_diff}</pre> : null}
                            </div>
                            <div className="controlRow" style={{ marginTop: 6 }}>
                              <Button variant="secondary" size="sm" onClick={() => jumpToIssue(issue, item.segment_id)}>
                                {t("qc.issueList.locateThisSegment")}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {segmentIds[0] ? (
                    <Button variant="secondary" size="sm" onClick={() => jumpToIssue(issue)}>
                      {t("qc.issueList.locateSegment")}
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
