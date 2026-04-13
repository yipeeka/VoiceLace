import { Download, Play, Square } from "lucide-react";
import { useEffect, useMemo } from "react";

import AudioPlayer from "../components/shared/AudioPlayer";
import CharacterBadge from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import SynthesisWaveSurfer from "../components/shared/SynthesisWaveSurfer";
import Button from "../components/ui/Button";
import Progress from "../components/ui/Progress";
import Select from "../components/ui/Select";
import Slider from "../components/ui/Slider";
import { usePlaybackQueue } from "../hooks/usePlaybackQueue";
import { useProjectStore } from "../stores/useProjectStore";
import { useSynthesisStore } from "../stores/useSynthesisStore";
import { useUiStore } from "../stores/useUiStore";
import { API_ORIGIN } from "../utils/api";

const STATUS_ICON = { done: "✅", running: "⏳", pending: "⬜", error: "❌", skipped: "⏭" };
const STATUS_ROW_CLS = { done: "done", running: "running", pending: "pending", error: "error" };

function formatTimeMs(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SynthesisPage() {
  const { currentProject, refreshCurrentProject } = useProjectStore();
  const {
    taskId, status, connectionStatus, modelStatus, lastSyncError, progress, segmentResults, fullAudioUrl, isRunning, error,
    subtitleSrtUrl, subtitleLrcUrl,
    startSynthesis, cancelSynthesis, reset,
  } = useSynthesisStore();

  const config = useSynthesisStore((s) => s.config ?? {
    num_step: 32,
    guidance_scale: 2,
    denoise: true,
    gap_duration_ms: 500,
    output_format: "wav",
  });

  const setConfig = (updater) =>
    useSynthesisStore.setState((s) => ({ config: { ...(s.config ?? {}), ...updater } }));

  useEffect(() => {
    if (currentProject?.synthesis_config) {
      setConfig(currentProject.synthesis_config);
    }
  }, [currentProject]);

  const segments = useMemo(
    () => Object.values(segmentResults || {}).sort((a, b) => a.index - b.index),
    [segmentResults]
  );

  const segmentTimings = useMemo(() => {
    let cursor = 0;
    const gapMs = Number(config.gap_duration_ms || 500);
    const timings = {};
    segments.forEach(seg => {
      const durationMs = seg.duration_ms || 0;
      const start = cursor;
      const end = cursor + durationMs;
      timings[seg.segment_id] = { start, end };
      cursor = end + gapMs;
    });
    return timings;
  }, [segments, config.gap_duration_ms]);

  const { isAutoPlay, currentSegmentId, playFrom, stop } = usePlaybackQueue(segments);

  const totalSegments = currentProject?.script?.segments?.length ?? 0;
  const progressPct = totalSegments > 0 ? Math.round((progress.current / totalSegments) * 100) : 0;

  async function handleStart() {
    if (!currentProject?.id) return;
    reset();
    await startSynthesis({
      projectId: currentProject.id,
      config: {
        ...config,
        guidance_scale: Number(config.guidance_scale),
        num_step: Number(config.num_step),
        gap_duration_ms: Number(config.gap_duration_ms),
      },
    });
    await refreshCurrentProject(currentProject.id);
  }

  return (
    <div className="pageGrid" style={{ gap: 20 }}>
      {/* Control row */}
      <div className="pageGrid twoCols" style={{ alignItems: "stretch" }}>
        <GlassCard>
          <h2 className="cardTitle">合成参数</h2>
          <p className="cardSubtitle">基于当前项目剧本与声音配置执行整本合成。</p>

          <Slider
            label="推理步数 (num_step)"
            value={[Number(config.num_step)]}
            onValueChange={([v]) => setConfig({ num_step: v })}
            min={8} max={100} step={4}
          />
          <Slider
            label="CFG 强度 (guidance_scale)"
            value={[Number(config.guidance_scale)]}
            onValueChange={([v]) => setConfig({ guidance_scale: v })}
            min={0.5} max={10} step={0.1}
          />
          <Slider
            label="段间静音 (ms)"
            value={[Number(config.gap_duration_ms)]}
            onValueChange={([v]) => setConfig({ gap_duration_ms: v })}
            min={0} max={2000} step={100} unit="ms"
          />

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">输出格式</label>
              <Select
                value={config.output_format}
                onValueChange={(v) => setConfig({ output_format: v })}
                options={[{ value: "wav", label: "WAV" }, { value: "mp3", label: "MP3" }]}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">降噪</label>
              <label
                className="controlRow"
                style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(config.denoise)}
                  onChange={(e) => setConfig({ denoise: e.target.checked })}
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
              onClick={handleStart}
            >
              {isRunning ? "合成中..." : "▶ 开始合成"}
            </Button>
            {isRunning && (
              <Button variant="danger" icon={Square} onClick={cancelSynthesis}>
                停止
              </Button>
            )}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {currentProject ? currentProject.name : "未选择项目"}
            </span>
          </div>
          {error && <div className="errorText">⚠ {error}</div>}
        </GlassCard>

        <GlassCard>
          <h2 className="cardTitle">任务状态</h2>
          <div className="listStack">
            <div className="statRow"><span>状态</span><strong>{modelStatus || status}</strong></div>
            <div className="statRow"><span>连接</span><strong>{connectionStatus}</strong></div>
            <div className="statRow">
              <span>进度</span>
              <strong style={{ fontFamily: "monospace" }}>{progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}</strong>
            </div>
            <div className="statRow"><span>Task ID</span><strong style={{ fontFamily: "monospace", fontSize: 11 }}>{taskId || "—"}</strong></div>
          </div>
          {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
          {(isRunning || status !== "idle") && (
            <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
          )}
          {fullAudioUrl && (
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <a className="downloadLink" href={fullAudioUrl} target="_blank" rel="noreferrer">
                <Download size={14} />
                下载完整音频
              </a>
              {subtitleSrtUrl ? (
                <a className="downloadLink" href={subtitleSrtUrl} target="_blank" rel="noreferrer">
                  下载 SRT
                </a>
              ) : null}
              {subtitleLrcUrl ? (
                <a className="downloadLink" href={subtitleLrcUrl} target="_blank" rel="noreferrer">
                  下载 LRC
                </a>
              ) : null}
              {currentProject?.id ? (
                <a
                  className="downloadLink"
                  href={`${API_ORIGIN}/api/v1/tts/export/${currentProject.id}/archive`}
                  target="_blank"
                  rel="noreferrer"
                >
                  下载完整工程 ZIP
                </a>
              ) : null}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Full audio player */}
      {fullAudioUrl && (
        <GlassCard>
          <h2 className="cardTitle">完整音频</h2>
          <SynthesisWaveSurfer 
            audioUrl={fullAudioUrl} 
            segments={segments} 
            gapDurationMs={Number(config.gap_duration_ms || 500)}
            height={80} 
          />
        </GlassCard>
      )}

      {/* Segment timeline */}
      <GlassCard className="fullWidthCard">
        <h2 className="cardTitle">分段时间线</h2>
        {segments.length ? (
          <div className="synthesisTimeline">
            {segments.map((seg) => {
              const segStatus = seg.status ?? "pending";
              return (
                <div
                  key={seg.segment_id}
                  className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"}`}
                  style={currentSegmentId === seg.segment_id ? { borderColor: "var(--accent-primary)" } : undefined}
                >
                  <div className="synthSegmentMeta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 11, minWidth: 24 }}>
                      #{(seg.index ?? 0) + 1}
                    </span>
                    <CharacterBadge name={seg.speaker} showDot />
                    {segStatus === "done" && segmentTimings[seg.segment_id] && (
                      <span style={{ 
                        color: "var(--text-muted)", 
                        fontFamily: "'JetBrains Mono', monospace", 
                        fontSize: 11,
                        background: "var(--bg-elevated)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-subtle)"
                      }}>
                        {formatTimeMs(segmentTimings[seg.segment_id].start)} - {formatTimeMs(segmentTimings[seg.segment_id].end)}
                      </span>
                    )}
                  </div>

                  <p
                    className="synthProgressBar"
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 240,
                    }}
                  >
                    {seg.text}
                  </p>

                  {seg.audio_url && segStatus === "done" && (
                    <div style={{ width: 200, flexShrink: 0 }}>
                      <AudioPlayer
                        audioUrl={`${API_ORIGIN}${seg.audio_url}`}
                        height={32}
                        compact
                      />
                    </div>
                  )}
                  {seg.audio_url && segStatus === "done" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Play}
                      onClick={async () => {
                        const ok = await playFrom(seg.segment_id);
                        if (!ok) {
                          useUiStore.getState().pushToast({ title: "连续播放启动失败，请重试。", tone: "error" });
                        }
                      }}
                    >
                      从此处连播
                    </Button>
                  )}

                  <span className="synthStatus">{STATUS_ICON[segStatus] ?? "⬜"}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="还没有分段结果"
            description="点击「开始合成」后每段音频完成时会在此显示"
          />
        )}
        {isAutoPlay ? (
          <div className="controlRow" style={{ marginTop: 12 }}>
            <span className="muted">连续播放进行中</span>
            <Button variant="danger" size="sm" onClick={stop}>停止连续播放</Button>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
