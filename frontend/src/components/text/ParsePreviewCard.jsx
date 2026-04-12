import GlassCard from "../shared/GlassCard";

export default function ParsePreviewCard({ llmStreamOutput }) {
  return (
    <GlassCard>
      <h2>解析预览</h2>
      <p className="muted">当前阶段用轮询式最小链路代替流式输出，先打通完整解析闭环。</p>
      <pre className="codeBlock">{llmStreamOutput || "等待解析输出..."}</pre>
    </GlassCard>
  );
}
