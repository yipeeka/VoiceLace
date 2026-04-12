import GlassCard from "../shared/GlassCard";
import StatusBadge from "../shared/StatusBadge";

export default function Header({ projectName }) {
  return (
    <GlassCard className="headerCard">
      <div>
        <div className="eyebrow">LOCAL AI AUDIOBOOK STUDIO</div>
        <h1 className="headerTitle">文本到多角色有声书</h1>
        <div className="muted">{projectName ? `当前项目：${projectName}` : "正在准备项目..."}</div>
      </div>
      <StatusBadge label="骨架已创建" tone="success" />
    </GlassCard>
  );
}
