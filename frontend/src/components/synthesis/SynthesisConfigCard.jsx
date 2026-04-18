import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Slider from "../ui/Slider";
import { Square } from "lucide-react";

export default function SynthesisConfigCard({
  config,
  currentProject,
  isRunning,
  error,
  onSetConfig,
  onStart,
  onCancel,
}) {
  return (
    <GlassCard>
      <h2 className="cardTitle">合成参数</h2>
      <p className="cardSubtitle">基于当前项目剧本与声音配置执行整本合成。</p>

      <Slider
        label="推理步数 (num_step)"
        value={[Number(config.num_step)]}
        onValueChange={([v]) => onSetConfig({ num_step: v })}
        min={8}
        max={100}
        step={4}
      />
      <Slider
        label="CFG 强度 (guidance_scale)"
        value={[Number(config.guidance_scale)]}
        onValueChange={([v]) => onSetConfig({ guidance_scale: v })}
        min={0.5}
        max={10}
        step={0.1}
      />
      <Slider
        label="段间静音 (ms)"
        value={[Number(config.gap_duration_ms)]}
        onValueChange={([v]) => onSetConfig({ gap_duration_ms: v })}
        min={0}
        max={2000}
        step={100}
        unit="ms"
      />

      <div className="editorGrid">
        <div className="formGroup">
          <label className="formLabel">输出格式</label>
          <Select
            value={config.output_format}
            onValueChange={(v) => onSetConfig({ output_format: v })}
            options={[
              { value: "wav", label: "WAV" },
              { value: "mp3", label: "MP3" },
            ]}
          />
        </div>
        <div className="formGroup">
          <label className="formLabel">降噪</label>
          <label
            className="controlRow"
            style={{
              cursor: "pointer",
              padding: "8px 12px",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-default)",
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(config.denoise)}
              onChange={(e) => onSetConfig({ denoise: e.target.checked })}
              style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
            />
            <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 denoise</span>
          </label>
        </div>
      </div>

      <div className="controlRow">
        <Button
          variant="primary"
          size="lg"
          disabled={!currentProject?.id || isRunning || !currentProject?.script?.segments?.length}
          onClick={onStart}
        >
          {isRunning ? "合成中..." : "▶ 开始合成"}
        </Button>
        {isRunning && (
          <Button variant="danger" icon={Square} onClick={onCancel}>
            停止
          </Button>
        )}
        <span className="muted" style={{ marginLeft: "auto" }}>
          {currentProject ? currentProject.name : "未选择项目"}
        </span>
      </div>
      {error && <div className="errorText">⚠ {error}</div>}
    </GlassCard>
  );
}
