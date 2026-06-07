import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Mic,
  Music,
  PlayCircle,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import Button from "../ui/Button";

const FLOW_STEPS = [
  { id: "speech", label: "语音识别", description: "ASR 转写音频", icon: Mic, action: "查看转写结果" },
  { id: "text", label: "文本输入", description: "导入或新建文本", icon: FileText, action: "重新导入" },
  { id: "qc", label: "解析质检", description: "解析片段并检查", icon: ShieldCheck, action: "查看质检报告" },
  { id: "script", label: "剧本编辑", description: "编辑、校对与润色脚本", icon: SlidersHorizontal, action: "继续编辑" },
  { id: "voice", label: "声音配置", description: "角色分配与声音设置", icon: Users, action: "开始配置" },
  { id: "music", label: "音乐生成", description: "生成并编排背景音乐", icon: Music, action: "生成音乐" },
  { id: "synth", label: "合成导出", description: "合成章节并导出成品", icon: Volume2, action: "合成预览" },
];

function getArtifact(stepId, { currentProject, sourceText, script }) {
  const segmentCount = script?.segments?.length || currentProject?.script?.segments?.length || 0;
  const wordCount = String(sourceText || script?.source_text || currentProject?.script?.source_text || "").length;
  const voiceCount = Object.keys(currentProject?.voice_assignments || {}).length;
  if (stepId === "speech") return wordCount ? `已获得 ${wordCount.toLocaleString("zh-CN")} 字文本` : "等待音频或字幕";
  if (stepId === "text") return currentProject?.name ? currentProject.name : "未选择项目";
  if (stepId === "qc") return segmentCount ? `片段 ${segmentCount.toLocaleString("zh-CN")} 段` : "尚未解析";
  if (stepId === "script") return segmentCount ? `可编辑 ${segmentCount.toLocaleString("zh-CN")} 段` : "等待剧本";
  if (stepId === "voice") return voiceCount ? `已绑定 ${voiceCount} 个角色` : "未配置";
  if (stepId === "music") return currentProject?.music_assets?.length ? `音乐 ${currentProject.music_assets.length} 条` : "未生成";
  if (stepId === "synth") return currentProject?.full_audio_url ? "成品音频可用" : "未设置导出";
  return "";
}

function getProgress(stepId, completed, active) {
  if (completed) return 100;
  if (active) {
    if (stepId === "script") return 62;
    if (stepId === "voice" || stepId === "music" || stepId === "synth") return 18;
    return 42;
  }
  return 0;
}

function getFlowWindowStartIndex(activePage) {
  const activeIndex = Math.max(0, FLOW_STEPS.findIndex((step) => step.id === activePage));
  const maxStartIndex = Math.max(0, FLOW_STEPS.length - 3);
  return Math.min(Math.max(0, activeIndex - 1), maxStartIndex);
}

export default function ProductionFlowOverview({
  activePage,
  completedPages = [],
  currentProject,
  sourceText,
  script,
  onNavigate,
}) {
  const [cardsCollapsed, setCardsCollapsed] = useState(false);
  const [startIndex, setStartIndex] = useState(() => getFlowWindowStartIndex(activePage));
  const visibleSteps = useMemo(
    () => FLOW_STEPS.slice(startIndex, startIndex + 3),
    [startIndex],
  );
  const activeStep = FLOW_STEPS.find((step) => step.id === activePage) || FLOW_STEPS[0];
  const canGoPrev = startIndex > 0;
  const canGoNext = startIndex < FLOW_STEPS.length - 3;

  useEffect(() => {
    setStartIndex(getFlowWindowStartIndex(activePage));
  }, [activePage]);

  return (
    <section className={`productionFlowPanel ${cardsCollapsed ? "cardsCollapsed" : ""}`} aria-labelledby="production-flow-title">
      <div className="flowPanelHeader">
        <div>
          <p className="eyebrow">Flow Command Center</p>
          <h2 id="production-flow-title">制作流程总览</h2>
          <p className="flowPanelHint">从左侧步骤开始，按顺序完成有声书制作流程。</p>
        </div>
        <div className="flowCarouselActions">
          {!cardsCollapsed ? (
            <>
              <button
                type="button"
                className="workspaceIconButton"
                disabled={!canGoPrev}
                onClick={() => setStartIndex((value) => Math.max(0, value - 1))}
                aria-label="查看上一组流程卡片"
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="workspaceIconButton"
                disabled={!canGoNext}
                onClick={() => setStartIndex((value) => Math.min(FLOW_STEPS.length - 3, value + 1))}
                aria-label="查看下一组流程卡片"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" iconRight={PlayCircle} onClick={() => onNavigate?.(activeStep.id)}>
            继续当前步骤
          </Button>
          <button
            type="button"
            className="workspaceIconButton flowCollapseButton"
            onClick={() => setCardsCollapsed((value) => !value)}
            aria-expanded={!cardsCollapsed}
            aria-controls="production-flow-cards"
            aria-label={cardsCollapsed ? "展开制作流程卡片" : "收起制作流程卡片"}
            title={cardsCollapsed ? "展开流程卡片" : "收起流程卡片"}
          >
            {cardsCollapsed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="flowNameRail" aria-label="全部制作步骤">
        {FLOW_STEPS.map((step) => {
          const completed = completedPages.includes(step.id);
          const active = activePage === step.id;
          return (
            <button
              type="button"
              key={step.id}
              className={`flowNameItem ${active ? "active" : ""} ${completed ? "completed" : ""}`}
              onClick={() => onNavigate?.(step.id)}
            >
              <span className="flowNameDot" aria-hidden="true" />
              {step.label}
            </button>
          );
        })}
      </div>

      <div
        id="production-flow-cards"
        className="flowCardCarousel"
        role="list"
        aria-label="制作流程卡片"
        hidden={cardsCollapsed}
      >
        {visibleSteps.map((step) => {
          const Icon = step.icon;
          const completed = completedPages.includes(step.id);
          const active = activePage === step.id;
          const progress = getProgress(step.id, completed, active);
          const statusLabel = completed ? "已完成" : active ? "进行中" : "待开始";
          const stepIndex = FLOW_STEPS.findIndex((item) => item.id === step.id);
          return (
            <button
              type="button"
              key={step.id}
              className={`flowCard ${active ? "active" : ""} ${completed ? "completed" : ""}`}
              onClick={() => onNavigate?.(step.id)}
              role="listitem"
            >
              <span className="flowCardTopline">
                <span className="flowStepNumber">{completed ? <CheckCircle2 size={15} /> : stepIndex + 1}</span>
                <span className={`flowStatusBadge ${completed ? "success" : active ? "active" : ""}`}>{statusLabel}</span>
              </span>
              <span className="flowCardTitle">
                <Icon className="flowStepIcon" size={22} aria-hidden="true" />
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
              </span>
              <span className="flowArtifact">{getArtifact(step.id, { currentProject, sourceText, script })}</span>
              <span className="flowProgressCell">
                <span className="flowProgressTrack">
                  <span style={{ width: `${progress}%` }} />
                </span>
                <span>{progress}%</span>
              </span>
              <span className="flowAction">{step.action}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
