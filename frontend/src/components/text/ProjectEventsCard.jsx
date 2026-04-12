import GlassCard from "../shared/GlassCard";

export default function ProjectEventsCard({ projectEvents }) {
  return (
    <GlassCard className="fullWidthCard">
      <h2>任务轨迹回放</h2>
      <p className="muted">来自项目级事件日志，刷新页面后仍可查看。</p>
      <pre className="codeBlock compactLog">{projectEvents.length ? JSON.stringify(projectEvents.slice(-20), null, 2) : "暂无事件日志。"}</pre>
    </GlassCard>
  );
}
