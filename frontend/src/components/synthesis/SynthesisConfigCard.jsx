import { ChevronDown, ChevronUp, Pause, Play, SlidersHorizontal, Square, Trash2, Upload, Wand2 } from "lucide-react";
import { useRef, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Slider from "../ui/Slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";

function CollapsibleHeader({ expanded, onToggle, title, subtitle, icon: Icon }) {
  return (
    <div className="sectionHeader">
      <div className="sectionHeaderLeft">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ justifyContent: "flex-start", paddingLeft: 0, paddingRight: 0 }}
          onClick={onToggle}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <Icon size={16} />
          {title}
        </button>
        <p className="cardSubtitle">{subtitle}</p>
      </div>
    </div>
  );
}

export function SynthesisGenerateCard({
  expanded,
  onToggle,
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
      <CollapsibleHeader
        expanded={expanded}
        onToggle={onToggle}
        title="合成参数"
        subtitle={expanded ? "设置 TTS 参数并执行整本合成。" : "已收起，点击展开。"}
        icon={SlidersHorizontal}
      />
      {!expanded ? (
        <div className="muted">已收起</div>
      ) : (
        <>
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
                <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
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
                onValueChange={([v]) => onSetConfig({ voxcpm2: { ...voxcpm2Config, inference_timesteps: v } })}
                min={4}
                max={30}
                step={1}
              />
              <Slider
                label="CFG 系数 (cfg_value)"
                value={[Number(voxcpm2Config.cfg_value)]}
                onValueChange={([v]) => onSetConfig({ voxcpm2: { ...voxcpm2Config, cfg_value: v } })}
                min={1}
                max={3}
                step={0.1}
              />
              <div className="editorGrid">
                <div className="formGroup">
                  <label className="formLabel">降噪</label>
                  <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(voxcpm2Config.denoise)}
                      onChange={(e) => onSetConfig({ voxcpm2: { ...voxcpm2Config, denoise: e.target.checked } })}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                    />
                    <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 denoise</span>
                  </label>
                </div>
                <div className="formGroup">
                  <label className="formLabel">文本归一化</label>
                  <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(voxcpm2Config.normalize)}
                      onChange={(e) => onSetConfig({ voxcpm2: { ...voxcpm2Config, normalize: e.target.checked } })}
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
            <div className="formGroup">
              <label className="formLabel">自动重试</label>
              <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.tts_auto_retry ?? true)}
                  onChange={(e) => onSetConfig({ tts_auto_retry: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>失败段自动重试</span>
              </label>
            </div>
          </div>

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">重试次数</label>
              <Select
                value={String(config.tts_retry_attempts ?? 2)}
                onValueChange={(value) => onSetConfig({ tts_retry_attempts: Number(value) })}
                options={[
                  { value: "0", label: "0 次" },
                  { value: "1", label: "1 次" },
                  { value: "2", label: "2 次" },
                  { value: "3", label: "3 次" },
                ]}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">段落并发</label>
              <Select
                value={String(config.tts_segment_concurrency ?? 1)}
                onValueChange={(value) => onSetConfig({ tts_segment_concurrency: Number(value) })}
                options={[
                  { value: "1", label: "1（稳定）" },
                  { value: "2", label: "2（实验）" },
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
            {isRunning ? <Button variant="danger" icon={Square} onClick={onCancel}>停止</Button> : null}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {currentProject ? currentProject.name : "未选择项目"}
            </span>
          </div>
          {error ? <div className="errorText">⚠ {error}</div> : null}
        </>
      )}
    </GlassCard>
  );
}

export function SynthesisPostprocessCard({
  expanded,
  onToggle,
  config,
  segments = [],
  currentProject,
  isRunning,
  isUploadingPostAsset,
  bgmPreviewUrl,
  ambiencePreviewUrl,
  onSetConfig,
  onStartPostprocess,
  onUploadPostprocessAsset,
  onClearPostprocessAsset,
}) {
  const bgmInputRef = useRef(null);
  const ambienceInputRef = useRef(null);
  const bgmAudioRef = useRef(null);
  const ambienceAudioRef = useRef(null);
  const [previewPlayingType, setPreviewPlayingType] = useState("");
  const chapterMarkers = Array.isArray(config.chapter_markers) ? config.chapter_markers : [];
  const hasRawFullAudio =
    Boolean(currentProject?.audio_assets?.full_wav_relpath) ||
    Boolean(currentProject?.audio_assets?.full_mp3_relpath);
  const segmentOptions = (segments || []).map((segment, index) => ({
    value: segment.id,
    label: `#${index + 1} ${(segment.text || "").slice(0, 18) || "空片段"}`,
  }));

  function updateChapterMarker(markerId, patch) {
    const next = chapterMarkers.map((item) => (item.id === markerId ? { ...item, ...patch } : item));
    onSetConfig({ chapter_markers: next });
  }

  function addChapterMarker() {
    const firstSegmentId = segments?.[0]?.id || "";
    if (!firstSegmentId) return;
    const markerId = `chapter-${Date.now()}`;
    onSetConfig({
      chapter_markers: [
        ...chapterMarkers,
        { id: markerId, title: `章节 ${chapterMarkers.length + 1}`, start_segment_id: firstSegmentId },
      ],
    });
  }

  function removeChapterMarker(markerId) {
    onSetConfig({ chapter_markers: chapterMarkers.filter((item) => item.id !== markerId) });
  }

  async function togglePreview(type) {
    const isBgm = type === "bgm";
    const audioRef = isBgm ? bgmAudioRef : ambienceAudioRef;
    const otherRef = isBgm ? ambienceAudioRef : bgmAudioRef;
    const audio = audioRef.current;
    const otherAudio = otherRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      setPreviewPlayingType((current) => (current === type ? "" : current));
      return;
    }

    if (otherAudio && !otherAudio.paused) {
      otherAudio.pause();
    }
    if (otherAudio) {
      otherAudio.currentTime = 0;
    }
    try {
      await audio.play();
      setPreviewPlayingType(type);
    } catch {
      setPreviewPlayingType("");
    }
  }

  return (
    <GlassCard>
      <CollapsibleHeader
        expanded={expanded}
        onToggle={onToggle}
        title="后期处理参数"
        subtitle={expanded ? "对已合成整轨执行后期处理和章节导出。" : "已收起，点击展开。"}
        icon={Wand2}
      />
      {!expanded ? (
        <div className="muted">已收起</div>
      ) : (
        <>
          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">启用后期处理</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.postprocess_enabled)}
                  onChange={(e) => onSetConfig({ postprocess_enabled: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>完成合成后可执行后期处理</span>
              </label>
            </div>
            <div className="formGroup">
              <label className="formLabel">MP3 码率</label>
              <Select
                value={String(config.mp3_bitrate_kbps || 192)}
                onValueChange={(v) => onSetConfig({ mp3_bitrate_kbps: Number(v) })}
                options={[
                  { value: "96", label: "96 kbps" },
                  { value: "128", label: "128 kbps" },
                  { value: "192", label: "192 kbps" },
                  { value: "256", label: "256 kbps" },
                  { value: "320", label: "320 kbps" },
                ]}
              />
            </div>
          </div>

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">响度归一化</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.loudness_normalize)}
                  onChange={(e) => onSetConfig({ loudness_normalize: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>目标 LUFS</span>
              </label>
              <Slider
                label="目标 LUFS"
                value={[Number(config.target_lufs ?? -16)]}
                onValueChange={([v]) => onSetConfig({ target_lufs: v })}
                min={-24}
                max={-10}
                step={1}
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">静音裁剪</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.trim_silence_enabled)}
                  onChange={(e) => onSetConfig({ trim_silence_enabled: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>裁剪首尾静音</span>
              </label>
              <Slider
                label="静音阈值 (dB)"
                value={[Number(config.trim_threshold_db ?? -45)]}
                onValueChange={([v]) => onSetConfig({ trim_threshold_db: v })}
                min={-70}
                max={-20}
                step={1}
              />
              <Slider
                label="最小静音块 (ms)"
                value={[Number(config.trim_min_silence_ms ?? 120)]}
                onValueChange={([v]) => onSetConfig({ trim_min_silence_ms: v })}
                min={20}
                max={500}
                step={10}
              />
            </div>
          </div>

          <div className="editorGrid">
            <Slider
              label="淡入 (ms)"
              value={[Number(config.fade_in_ms ?? 40)]}
              onValueChange={([v]) => onSetConfig({ fade_in_ms: v })}
              min={0}
              max={1500}
              step={10}
              unit="ms"
            />
            <Slider
              label="淡出 (ms)"
              value={[Number(config.fade_out_ms ?? 80)]}
              onValueChange={([v]) => onSetConfig({ fade_out_ms: v })}
              min={0}
              max={2000}
              step={10}
              unit="ms"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">章节标记</label>
            <div className="listStack">
              {chapterMarkers.map((item) => (
                <div key={item.id} className="editorGrid" style={{ alignItems: "end" }}>
                  <div className="formGroup">
                    <label className="formLabel">章节名</label>
                    <input
                      className="input"
                      value={item.title || ""}
                      onChange={(e) => updateChapterMarker(item.id, { title: e.target.value })}
                      placeholder="章节标题"
                    />
                  </div>
                  <div className="formGroup">
                    <label className="formLabel">起始片段</label>
                    <Select
                      value={item.start_segment_id || ""}
                      onValueChange={(value) => updateChapterMarker(item.id, { start_segment_id: value })}
                      options={segmentOptions}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeChapterMarker(item.id)}>删除</Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={addChapterMarker} disabled={!segmentOptions.length}>
                添加章节标记
              </Button>
            </div>
          </div>

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">背景音乐</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  onClick={() => bgmInputRef.current?.click()}
                  disabled={isUploadingPostAsset}
                >
                  {isUploadingPostAsset ? "上传中..." : "上传 BGM"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onClearPostprocessAsset?.("bgm")}
                  disabled={isUploadingPostAsset || !config.bgm_track?.relpath}
                >
                  删除
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={previewPlayingType === "bgm" ? Pause : Play}
                  onClick={() => togglePreview("bgm")}
                  disabled={isUploadingPostAsset || !config.bgm_track?.relpath || !bgmPreviewUrl}
                >
                  {previewPlayingType === "bgm" ? "暂停" : "播放"}
                </Button>
                <span className="muted" style={{ fontSize: 12 }}>{config.bgm_track?.relpath || "未绑定"}</span>
              </div>
              <input
                ref={bgmInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onUploadPostprocessAsset?.("bgm", file);
                }}
              />
              <audio
                ref={bgmAudioRef}
                src={bgmPreviewUrl || ""}
                preload="metadata"
                onEnded={() => setPreviewPlayingType((current) => (current === "bgm" ? "" : current))}
                style={{ display: "none" }}
              />
              <Slider
                label="BGM 增益 (dB)"
                value={[Number(config.bgm_track?.gain_db ?? 0)]}
                onValueChange={([v]) => onSetConfig({ bgm_track: { ...(config.bgm_track || {}), gain_db: v } })}
                min={-30}
                max={12}
                step={1}
              />
              <div className="editorGrid">
                <label className="controlRow" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(config.bgm_track?.loop ?? true)}
                    onChange={(e) => onSetConfig({ bgm_track: { ...(config.bgm_track || {}), loop: e.target.checked } })}
                    style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                  />
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>循环</span>
                </label>
                <label className="controlRow" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(config.bgm_track?.ducking_enabled ?? false)}
                    onChange={(e) =>
                      onSetConfig({ bgm_track: { ...(config.bgm_track || {}), ducking_enabled: e.target.checked } })
                    }
                    style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                  />
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 Ducking</span>
                </label>
              </div>
              <Slider
                label="Ducking 抑制 (dB)"
                value={[Number(config.bgm_track?.ducking_db ?? 8)]}
                onValueChange={([v]) => onSetConfig({ bgm_track: { ...(config.bgm_track || {}), ducking_db: v } })}
                min={0}
                max={24}
                step={1}
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">环境音</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  onClick={() => ambienceInputRef.current?.click()}
                  disabled={isUploadingPostAsset}
                >
                  {isUploadingPostAsset ? "上传中..." : "上传环境音"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onClearPostprocessAsset?.("ambience")}
                  disabled={isUploadingPostAsset || !config.ambience_track?.relpath}
                >
                  删除
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={previewPlayingType === "ambience" ? Pause : Play}
                  onClick={() => togglePreview("ambience")}
                  disabled={isUploadingPostAsset || !config.ambience_track?.relpath || !ambiencePreviewUrl}
                >
                  {previewPlayingType === "ambience" ? "暂停" : "播放"}
                </Button>
                <span className="muted" style={{ fontSize: 12 }}>{config.ambience_track?.relpath || "未绑定"}</span>
              </div>
              <input
                ref={ambienceInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onUploadPostprocessAsset?.("ambience", file);
                }}
              />
              <audio
                ref={ambienceAudioRef}
                src={ambiencePreviewUrl || ""}
                preload="metadata"
                onEnded={() => setPreviewPlayingType((current) => (current === "ambience" ? "" : current))}
                style={{ display: "none" }}
              />
              <Slider
                label="环境音增益 (dB)"
                value={[Number(config.ambience_track?.gain_db ?? 0)]}
                onValueChange={([v]) => onSetConfig({ ambience_track: { ...(config.ambience_track || {}), gain_db: v } })}
                min={-30}
                max={12}
                step={1}
              />
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.ambience_track?.loop ?? true)}
                  onChange={(e) => onSetConfig({ ambience_track: { ...(config.ambience_track || {}), loop: e.target.checked } })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>循环</span>
              </label>
            </div>
          </div>

          <div className="controlRow">
            <Button
              variant="primary"
              size="lg"
              icon={Play}
              disabled={!currentProject?.id || isRunning || !currentProject?.script?.segments?.length || !hasRawFullAudio}
              onClick={onStartPostprocess}
            >
              开始后期
            </Button>
            {!hasRawFullAudio ? <span className="muted" style={{ fontSize: 12 }}>需先完成一次整本合成后才能后期处理</span> : null}
          </div>
        </>
      )}
    </GlassCard>
  );
}
