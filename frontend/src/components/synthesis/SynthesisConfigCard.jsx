import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Slider from "../ui/Slider";
import { Square } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";

export default function SynthesisConfigCard({
  config,
  currentProject,
  isRunning,
  error,
  onSetConfig,
  onStart,
  onCancel,
}) {
  const ttsBackend = config.tts_backend || "omnivoice";
  const omnivoiceConfig = {
    num_step: Number(config?.omnivoice?.num_step ?? config.num_step ?? 32),
    guidance_scale: Number(config?.omnivoice?.guidance_scale ?? config.guidance_scale ?? 2),
    denoise: Boolean(config?.omnivoice?.denoise ?? config.denoise ?? true),
  };
  const voxcpm2Config = {
    inference_timesteps: Number(config?.voxcpm2?.inference_timesteps ?? 10),
    cfg_value: Number(config?.voxcpm2?.cfg_value ?? 2),
    denoise: Boolean(config?.voxcpm2?.denoise ?? false),
    normalize: Boolean(config?.voxcpm2?.normalize ?? true),
  };

  return (
    <GlassCard>
      <h2 className="cardTitle">合成参数</h2>
      <p className="cardSubtitle">基于当前项目剧本与声音配置执行整本合成。</p>

      <Tabs value={ttsBackend} onValueChange={(value) => onSetConfig({ tts_backend: value })}>
        <TabsList>
          <TabsTrigger value="omnivoice">OmniVoice</TabsTrigger>
          <TabsTrigger value="voxcpm2">VoxCPM2</TabsTrigger>
        </TabsList>

        <TabsContent value="omnivoice">
          <Slider
            label="推理步数 (num_step)"
            value={[Number(omnivoiceConfig.num_step)]}
            onValueChange={([v]) =>
              onSetConfig({
                num_step: v,
                denoise: omnivoiceConfig.denoise,
                guidance_scale: omnivoiceConfig.guidance_scale,
                omnivoice: { ...omnivoiceConfig, num_step: v },
              })
            }
            min={8}
            max={100}
            step={4}
          />
          <Slider
            label="CFG 强度 (guidance_scale)"
            value={[Number(omnivoiceConfig.guidance_scale)]}
            onValueChange={([v]) =>
              onSetConfig({
                num_step: omnivoiceConfig.num_step,
                denoise: omnivoiceConfig.denoise,
                guidance_scale: v,
                omnivoice: { ...omnivoiceConfig, guidance_scale: v },
              })
            }
            min={0.5}
            max={10}
            step={0.1}
          />
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
                checked={Boolean(omnivoiceConfig.denoise)}
                onChange={(e) =>
                  onSetConfig({
                    num_step: omnivoiceConfig.num_step,
                    guidance_scale: omnivoiceConfig.guidance_scale,
                    denoise: e.target.checked,
                    omnivoice: { ...omnivoiceConfig, denoise: e.target.checked },
                  })
                }
                style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
              />
              <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 denoise</span>
            </label>
          </div>
        </TabsContent>

        <TabsContent value="voxcpm2">
          <Slider
            label="采样步数 (inference_timesteps)"
            value={[Number(voxcpm2Config.inference_timesteps)]}
            onValueChange={([v]) =>
              onSetConfig({
                voxcpm2: { ...voxcpm2Config, inference_timesteps: v },
              })
            }
            min={4}
            max={30}
            step={1}
          />
          <Slider
            label="CFG 系数 (cfg_value)"
            value={[Number(voxcpm2Config.cfg_value)]}
            onValueChange={([v]) =>
              onSetConfig({
                voxcpm2: { ...voxcpm2Config, cfg_value: v },
              })
            }
            min={1}
            max={3}
            step={0.1}
          />
          <div className="editorGrid">
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
                  checked={Boolean(voxcpm2Config.denoise)}
                  onChange={(e) =>
                    onSetConfig({
                      voxcpm2: { ...voxcpm2Config, denoise: e.target.checked },
                    })
                  }
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 denoise</span>
              </label>
            </div>
            <div className="formGroup">
              <label className="formLabel">文本归一化</label>
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
                  checked={Boolean(voxcpm2Config.normalize)}
                  onChange={(e) =>
                    onSetConfig({
                      voxcpm2: { ...voxcpm2Config, normalize: e.target.checked },
                    })
                  }
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>normalize</span>
              </label>
            </div>
          </div>
        </TabsContent>
      </Tabs>

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
