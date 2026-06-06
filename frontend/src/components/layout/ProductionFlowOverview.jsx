import {
  BookOpen,
  CheckCircle2,
  FileText,
  Mic,
  Music,
  PlayCircle,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
  Volume2,
} from "lucide-react";

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

export default function ProductionFlowOverview({
  activePage,
  completedPages = [],
  currentProject,
  sourceText,
  script,
  onNavigate,
}) {
  const completedCount = completedPages.length;
  const activeStep = FLOW_STEPS.find((step) => step.id === activePage) || FLOW_STEPS[0];

  return (
    <section className="productionFlowPanel" aria-labelledby="production-flow-title">
      <div className="flowPanelHeader">
        <div>
          <p className="eyebrow">Flow Command Center</p>
          <h2 id="production-flow-title">制作流程总览</h2>
          <p className="flowPanelHint">从左侧步骤开始，按顺序完成有声书制作流程。</p>
        </div>
        <Button variant="ghost" size="sm" iconRight={PlayCircle} onClick={() => onNavigate?.(activeStep.id)}>
          继续当前步骤
        </Button>
      </div>

      <div className="flowTable" role="list">
        <div className="flowTableHeader" aria-hidden="true">
          <span>步骤</span>
          <span>状态</span>
          <span>最近文件 / 结果</span>
          <span>进度</span>
          <span>下一步操作</span>
        </div>
        {FLOW_STEPS.map((step, index) => {
          const Icon = step.icon;
          const completed = completedPages.includes(step.id);
          const active = activePage === step.id;
          const progress = getProgress(step.id, completed, active);
          const statusLabel = completed ? "已完成" : active ? "进行中" : "待开始";
          return (
            <button
              type="button"
              key={step.id}
              className={`flowRow ${active ? "active" : ""} ${completed ? "completed" : ""}`}
              onClick={() => onNavigate?.(step.id)}
              role="listitem"
            >
              <span className="flowStepCell">
                <span className="flowStepNumber">{completed ? <CheckCircle2 size={15} /> : index + 1}</span>
                <Icon className="flowStepIcon" size={22} aria-hidden="true" />
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
              </span>
              <span className={`flowStatusBadge ${completed ? "success" : active ? "active" : ""}`}>{statusLabel}</span>
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

      <div className="flowBottomGrid">
        <div className="flowDropTarget">
          <Upload size={34} aria-hidden="true" />
          <div>
            <strong>导入音频开始转写</strong>
            <span>支持 wav / flac / mp3 / m4a / aac 等格式</span>
          </div>
          <Button variant="primary" size="sm" onClick={() => onNavigate?.("speech")}>选择文件</Button>
        </div>
        <div className="flowContinueCard">
          <BookOpen size={24} aria-hidden="true" />
          <div>
            <strong>{currentProject?.name || "当前项目"}</strong>
            <span>已完成 {completedCount}/7 个步骤</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onNavigate?.(activeStep.id)}>继续项目</Button>
        </div>
      </div>
    </section>
  );
}
