import { AlertTriangle, AudioLines, ChevronDown, ChevronUp, Pause, Play, SlidersHorizontal, Square, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Slider from "../ui/Slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";

function CollapsibleHeader({ expanded, onToggle, title, subtitle, icon: Icon }) {
  return (
    <div className="sectionHeader synthesisConsoleHeader">
      <div className="sectionHeaderLeft">
        <button
          type="button"
          className="btn btn-ghost btn-sm synthesisConsoleTitleButton"
          style={{ justifyContent: "flex-start", paddingLeft: 0, paddingRight: 0 }}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp aria-hidden="true" focusable="false" size={14} /> : <ChevronDown aria-hidden="true" focusable="false" size={14} />}
          <Icon aria-hidden="true" focusable="false" size={16} />
          {title}
        </button>
        <p className="cardSubtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function ConsoleSection({ title, meta, children, className = "" }) {
  return (
    <section className={`consoleSection ${className}`.trim()}>
      <div className="consoleSectionHeader">
        <span>{title}</span>
        {meta ? <strong>{meta}</strong> : null}
      </div>
      <div className="consoleSectionBody">{children}</div>
    </section>
  );
}

function SwitchRow({ title, description, checked, disabled = false, onChange }) {
  return (
    <label className={`consoleSwitchRow ${disabled ? "disabled" : ""}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="consoleSwitchCopy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function SynthesisGenerateCard({
  expanded,
  onToggle,
  config,
  currentProject,
  selectedSegmentCount = 0,
  isRunning,
  error,
  onSetConfig,
  onApplySegmentSpeed,
  onStart,
  onCancel,
  isDubbingSourceProject = false,
}) {
  const speedInputId = useId();
  const [speedDraft, setSpeedDraft] = useState("1.0");
  const requestedBackend = config.tts_backend || "omnivoice";
  const ttsBackend = requestedBackend;
  const showTimelineLock = true;
  const canUseTimelineLock = isDubbingSourceProject;
  const timelineLockActive = Boolean(isDubbingSourceProject && config.timeline_lock_enabled);
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
    <GlassCard className="synthesisConsolePanel synthesisGeneratePanel">
      <CollapsibleHeader
        expanded={expanded}
        onToggle={onToggle}
        title="合成控制"
        subtitle={expanded ? "" : "已收起，点击展开。"}
        icon={SlidersHorizontal}
      />
      {!expanded ? (
        <div className="muted">已收起</div>
      ) : (
        <>
          <ConsoleSection title="模型参数" meta={ttsBackend === "omnivoice" ? "OmniVoice" : "VoxCPM2"}>
            <Tabs value={ttsBackend} onValueChange={(value) => onSetConfig({ tts_backend: value })}>
              <TabsList>
                <TabsTrigger value="omnivoice">OmniVoice</TabsTrigger>
                <TabsTrigger value="voxcpm2">VoxCPM2</TabsTrigger>
              </TabsList>

              <TabsContent value="omnivoice" className="consoleSectionStack">
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
                <SwitchRow
                  title="降噪"
                  description="启用 denoise"
                  checked={Boolean(omnivoiceConfig.denoise)}
                  onChange={(checked) =>
                    onSetConfig({
                      num_step: omnivoiceConfig.num_step,
                      guidance_scale: omnivoiceConfig.guidance_scale,
                      denoise: checked,
                      omnivoice: { ...omnivoiceConfig, denoise: checked },
                    })
                  }
                />
              </TabsContent>

              <TabsContent value="voxcpm2" className="consoleSectionStack">
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
                <div className="consoleSwitchGrid">
                  <SwitchRow
                    title="降噪"
                    description="denoise"
                    checked={Boolean(voxcpm2Config.denoise)}
                    onChange={(checked) => onSetConfig({ voxcpm2: { ...voxcpm2Config, denoise: checked } })}
                  />
                  <SwitchRow
                    title="文本归一化"
                    description="normalize"
                    checked={Boolean(voxcpm2Config.normalize)}
                    onChange={(checked) => onSetConfig({ voxcpm2: { ...voxcpm2Config, normalize: checked } })}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </ConsoleSection>

          <ConsoleSection title="时序控制" meta={timelineLockActive ? "已锁定" : "自由间隔"}>
            <Slider
              label="段间静音 (ms)"
              value={[Number(config.gap_duration_ms)]}
              onValueChange={([v]) => onSetConfig({ gap_duration_ms: v })}
              min={0}
              max={2000}
              step={100}
              unit="ms"
            />
            {showTimelineLock ? (
              <SwitchRow
                title="时间轴锁定合成"
                description={
                  isDubbingSourceProject
                    ? "按 source_start_ms 放置音频"
                    : "仅配音/字幕时间轴项目可用"
                }
                checked={canUseTimelineLock && Boolean(config.timeline_lock_enabled)}
                disabled={!canUseTimelineLock || isRunning}
                onChange={(checked) => onSetConfig({ timeline_lock_enabled: checked })}
              />
            ) : null}
          </ConsoleSection>

          {!timelineLockActive && ttsBackend !== "voxcpm2" ? (
            <ConsoleSection title="批量语速" meta={selectedSegmentCount ? `${selectedSegmentCount} 已选` : "全部片段"}>
              <label className="formLabel" htmlFor={speedInputId}>片段 speed（批量写入 tts_overrides）</label>
              <div className="consoleSpeedRow">
                <input
                  id={speedInputId}
                  name="segment-speed"
                  className="textInput"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={speedDraft}
                  onChange={(event) => setSpeedDraft(event.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={isRunning || !currentProject?.id || !currentProject?.script?.segments?.length}
                  onClick={() => onApplySegmentSpeed?.(Number(speedDraft), "all")}
                >
                  应用到全部片段
                </Button>
                <Button
                  variant="secondary"
                  disabled={isRunning || !selectedSegmentCount}
                  onClick={() => onApplySegmentSpeed?.(Number(speedDraft), "selected")}
                >
                  应用到选中片段{selectedSegmentCount ? ` (${selectedSegmentCount})` : ""}
                </Button>
              </div>
              <div className="consoleHint">
                若项目已有每段 <code>duration</code>，模型通常会优先按 duration 控制时长；遇到吞音时可降低 speed 或删除过短片段的 duration 后重生成。
              </div>
            </ConsoleSection>
          ) : null}

          <ConsoleSection title="输出与容错" meta={String(config.output_format || "wav").toUpperCase()}>
            <div className="consoleFieldGrid">
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
              <SwitchRow
                title="自动重试"
                description="失败段自动重试"
                checked={Boolean(config.tts_auto_retry ?? true)}
                onChange={(checked) => onSetConfig({ tts_auto_retry: checked })}
              />
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
          </ConsoleSection>

          <div className="controlRow synthesisConsoleActionRow">
            <Button
              variant="primary"
              size="lg"
              disabled={!currentProject?.id || isRunning || !currentProject?.script?.segments?.length}
              onClick={onStart}
            >
              {isRunning ? "合成中…" : "▶ 合成"}
            </Button>
            {isRunning ? <Button variant="danger" icon={Square} onClick={onCancel}>取消任务</Button> : null}
            <span className="muted synthesisConsoleProjectName">
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
  onSetConfig,
  onStartPostprocess,
  onExtractBackground,
  onUploadPostprocessAsset,
  onClearPostprocessAsset,
  selectedTrackId = "",
  pendingTrackOffsets = {},
  onSelectTrack,
  onApplyPendingTrackOffset,
  onClearPendingTrackOffset,
  API_ORIGIN = "",
}) {
  const musicInputRef = useRef(null);
  const effectInputRef = useRef(null);
  const previewAudioRef = useRef(null);
  const trackItemRefs = useRef({});
  const [previewPlayingTrackId, setPreviewPlayingTrackId] = useState("");
  const chapterMarkers = Array.isArray(config.chapter_markers) ? config.chapter_markers : [];
  const processedChapters = Array.isArray(currentProject?.audio_assets?.processed?.chapters)
    ? currentProject.audio_assets.processed.chapters
    : [];
  const hasRawFullAudio =
    Boolean(currentProject?.audio_assets?.full_wav_relpath) ||
    Boolean(currentProject?.audio_assets?.full_mp3_relpath);
  const hasProcessedAudio =
    Boolean(currentProject?.audio_assets?.processed?.full_wav_relpath) ||
    Boolean(currentProject?.audio_assets?.processed?.full_mp3_relpath);
  const hasSourceAudio =
    Boolean(currentProject?.audio_assets?.source_audio_wav_relpath) ||
    Boolean(currentProject?.audio_assets?.source_audio_mp3_relpath);
  const segmentOptions = (segments || []).map((segment, index) => ({
    value: segment.id,
    label: `#${index + 1} ${(segment.text || "").slice(0, 18) || "空片段"}`,
  }));
  const rawMusicTracks = Array.isArray(config.music_tracks) ? config.music_tracks : [];
  const rawEffectTracks = Array.isArray(config.effect_tracks) ? config.effect_tracks : [];
  const currentChapterSignature = JSON.stringify(
    chapterMarkers.map((chapter, index) => ({
      title: String(chapter?.title || `章节 ${index + 1}`).trim(),
      start_segment_id: String(chapter?.start_segment_id || ""),
    })),
  );
  const processedChapterSignature = JSON.stringify(
    processedChapters.map((chapter, index) => ({
      title: String(chapter?.title || `章节 ${index + 1}`).trim(),
      start_segment_id: String(chapter?.start_segment_id || ""),
    })),
  );
  const hasPendingChapterPostprocess = hasProcessedAudio
    ? currentChapterSignature !== processedChapterSignature
    : chapterMarkers.length > 0;
  const pendingChapterPostprocessText = hasPendingChapterPostprocess
    ? hasProcessedAudio
      ? "章节标记已变更，执行后期处理后导出中心会更新。"
      : "章节标记尚未执行后期处理，完成后才会出现在导出中心。"
    : "";

  function basename(relpath) {
    const value = String(relpath || "");
    return value.split(/[\\/]/).pop() || "";
  }

  function normalizeTrack(track, kind, index, legacyKey = "") {
    const relpath = String(track?.relpath || "");
    return {
      ...(track || {}),
      id: legacyKey || String(track?.id || `${kind}-${index + 1}`),
      label: String(track?.label || basename(relpath).replace(/\.[^.]+$/, "") || `${kind === "music" ? "音乐" : "音效"} ${index + 1}`),
      relpath,
      gain_db: Number(track?.gain_db ?? 0),
      ducking_enabled: Boolean(track?.ducking_enabled ?? false),
      ducking_db: Number(track?.ducking_db ?? 8),
      loop: Boolean(track?.loop ?? true),
      offset_ms: Number(track?.offset_ms ?? 0),
      legacyKey,
    };
  }

  function withPendingOffset(track) {
    const pending = pendingTrackOffsets?.[track.id];
    if (!pending || !Number.isFinite(Number(pending.offset_ms))) {
      return track;
    }
    return {
      ...track,
      pending_offset_ms: Number(pending.offset_ms),
    };
  }

  const musicTracks = [
    ...(config.bgm_track?.relpath ? [normalizeTrack(config.bgm_track, "music", 0, "legacy-bgm")] : []),
    ...rawMusicTracks.map((track, index) => normalizeTrack(track, "music", index)),
  ].map(withPendingOffset);
  const effectTracks = [
    ...(config.ambience_track?.relpath ? [normalizeTrack(config.ambience_track, "effect", 0, "legacy-ambience")] : []),
    ...rawEffectTracks.map((track, index) => normalizeTrack(track, "effect", index)),
  ].map(withPendingOffset);

  function scrollTrackItemIntoRail(trackId) {
    const item = trackItemRefs.current[trackId];
    const rail = item?.closest?.(".synthesisCommandRail");
    if (!item || !rail) {
      return;
    }
    const windowScrollX = window.scrollX;
    const windowScrollY = window.scrollY;
    const railRect = rail.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const topPadding = 12;
    const nextTop = Math.max(
      0,
      Math.min(
        rail.scrollHeight - rail.clientHeight,
        rail.scrollTop + itemRect.top - railRect.top - topPadding,
      ),
    );
    rail.scrollTo({ top: nextTop, behavior: "smooth" });
    requestAnimationFrame(() => {
      window.scrollTo(windowScrollX, windowScrollY);
    });
  }

  useEffect(() => {
    if (!selectedTrackId || !expanded) return undefined;
    const timer = window.setTimeout(() => scrollTrackItemIntoRail(selectedTrackId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedTrackId, expanded]);

  function selectTrack(trackId) {
    onSelectTrack?.(trackId);
  }

  function updateTrack(kind, trackId, patch) {
    if (Object.prototype.hasOwnProperty.call(patch, "offset_ms")) {
      onClearPendingTrackOffset?.(trackId);
    }
    if (trackId === "legacy-bgm") {
      onSetConfig({ bgm_track: { ...(config.bgm_track || {}), ...patch } });
      return;
    }
    if (trackId === "legacy-ambience") {
      onSetConfig({ ambience_track: { ...(config.ambience_track || {}), ...patch } });
      return;
    }
    const key = kind === "music" ? "music_tracks" : "effect_tracks";
    const sourceTracks = Array.isArray(config[key]) ? config[key] : [];
    onSetConfig({
      [key]: sourceTracks.map((track, index) => {
        const id = String(track?.id || `${kind}-${index + 1}`);
        return id === trackId ? { ...track, ...patch } : track;
      }),
    });
  }

  function removeTrack(kind, trackId) {
    if (previewPlayingTrackId === trackId && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setPreviewPlayingTrackId("");
    }
    if (selectedTrackId === trackId) {
      selectTrack("");
    }
    if (trackId === "legacy-bgm") {
      onClearPostprocessAsset?.("bgm");
      return;
    }
    if (trackId === "legacy-ambience") {
      onClearPostprocessAsset?.("ambience");
      return;
    }
    const key = kind === "music" ? "music_tracks" : "effect_tracks";
    const sourceTracks = Array.isArray(config[key]) ? config[key] : [];
    onSetConfig({
      [key]: sourceTracks.filter((track, index) => String(track?.id || `${kind}-${index + 1}`) !== trackId),
    });
  }

  function trackPreviewUrl(kind, track) {
    if (!currentProject?.id || !track?.relpath) {
      return "";
    }
    const query = new URLSearchParams({
      type: kind,
      track_id: track.id,
      v: `${currentProject.updated_at || ""}:${track.relpath}`,
    });
    return `${API_ORIGIN}/api/v1/tts/projects/${currentProject.id}/postprocess/assets/preview?${query.toString()}`;
  }

  async function toggleTrackPreview(kind, track) {
    const audio = previewAudioRef.current;
    const url = trackPreviewUrl(kind, track);
    if (!audio || !url) {
      return;
    }
    if (previewPlayingTrackId === track.id && !audio.paused) {
      audio.pause();
      setPreviewPlayingTrackId("");
      return;
    }
    audio.pause();
    audio.src = url;
    audio.currentTime = 0;
    try {
      await audio.play();
      setPreviewPlayingTrackId(track.id);
      selectTrack(track.id);
    } catch {
      setPreviewPlayingTrackId("");
    }
  }

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

  function renderTrackList(kind, tracks) {
    const isMusic = kind === "music";
    return (
      <div className="postprocessTrackGroup">
        <div className="postprocessTrackGroupHeader">
          <div>
            <strong>{isMusic ? "音乐" : "音效"}</strong>
            <span>{tracks.length} 条</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={Upload}
            disabled={isUploadingPostAsset}
            onClick={() => (isMusic ? musicInputRef : effectInputRef).current?.click()}
          >
            {isUploadingPostAsset ? "上传中…" : isMusic ? "添加音乐" : "添加音效"}
          </Button>
        </div>
        {tracks.length ? (
          <div className="postprocessTrackList">
            {tracks.map((track) => (
              (() => {
                const hasPendingOffset = Number.isFinite(Number(track.pending_offset_ms));
                const effectiveOffsetMs = hasPendingOffset ? Number(track.pending_offset_ms) : track.offset_ms;
                return (
              <div
                key={track.id}
                ref={(node) => {
                  if (node) {
                    trackItemRefs.current[track.id] = node;
                  } else {
                    delete trackItemRefs.current[track.id];
                  }
                }}
                className={`postprocessTrackItem ${selectedTrackId === track.id ? "active" : ""} ${hasPendingOffset ? "pending" : ""}`}
                onClick={() => selectTrack(track.id)}
              >
                <div className="postprocessTrackItemHeader">
                  <input
                    className="input"
                    value={track.label}
                    onChange={(event) => updateTrack(kind, track.id, { label: event.target.value })}
                    aria-label={`${isMusic ? "音乐" : "音效"}名称`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={previewPlayingTrackId === track.id ? Pause : Play}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTrackPreview(kind, track);
                    }}
                    disabled={!currentProject?.id || !track.relpath}
                  >
                    {previewPlayingTrackId === track.id ? "暂停" : "试听"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => removeTrack(kind, track.id)}
                    disabled={isUploadingPostAsset}
                  >
                    删除
                  </Button>
                </div>
                <span className="muted postprocessAssetPath" title={track.relpath || "未绑定"}>
                  {track.relpath || "未绑定"}
                </span>
                <Slider
                  label="增益 (dB)"
                  value={[track.gain_db]}
                  onValueChange={([v]) => updateTrack(kind, track.id, { gain_db: v })}
                  min={-30}
                  max={12}
                  step={1}
                />
                <Slider
                  label="偏移 (ms)"
                  value={[effectiveOffsetMs]}
                  onValueChange={([v]) => updateTrack(kind, track.id, { offset_ms: v })}
                  min={-30000}
                  max={30000}
                  step={50}
                  unit="ms"
                />
                {hasPendingOffset ? (
                  <div className="postprocessTrackPendingBar">
                    <span>时间轴改动待应用：{effectiveOffsetMs}ms</span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onApplyPendingTrackOffset?.(kind, track.id);
                      }}
                    >
                      应用
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onClearPendingTrackOffset?.(track.id);
                      }}
                    >
                      撤销
                    </Button>
                  </div>
                ) : null}
                <div className="postprocessTrackFlags">
                  <label className="controlRow" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={track.loop}
                      onChange={(event) => updateTrack(kind, track.id, { loop: event.target.checked })}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                    />
                    <span>循环</span>
                  </label>
                  {isMusic ? (
                    <label className="controlRow" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={track.ducking_enabled}
                        onChange={(event) => updateTrack(kind, track.id, { ducking_enabled: event.target.checked })}
                        style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                      />
                      <span>Ducking</span>
                    </label>
                  ) : null}
                </div>
                {isMusic && track.ducking_enabled ? (
                  <Slider
                    label="Ducking 抑制 (dB)"
                    value={[track.ducking_db]}
                    onValueChange={([v]) => updateTrack(kind, track.id, { ducking_db: v })}
                    min={0}
                    max={24}
                    step={1}
                  />
                ) : null}
              </div>
                );
              })()
            ))}
          </div>
        ) : (
          <div className="postprocessTrackEmpty">未添加{isMusic ? "音乐" : "音效"}</div>
        )}
      </div>
    );
  }

  return (
    <GlassCard className="synthesisConsolePanel synthesisPostprocessPanel">
      <audio
        ref={previewAudioRef}
        preload="metadata"
        onEnded={() => setPreviewPlayingTrackId("")}
        style={{ display: "none" }}
      />
      <CollapsibleHeader
        expanded={expanded}
        onToggle={onToggle}
        title="后期处理"
        subtitle={expanded ? "" : "已收起，点击展开。"}
        icon={Wand2}
      />
      {!expanded ? (
        <div className="muted">已收起</div>
      ) : (
        <>
          <ConsoleSection title="基础设置" meta={config.postprocess_enabled ? "启用" : "关闭"}>
            <SwitchRow
              title="启用后期处理"
              description="完成合成后可执行"
              checked={Boolean(config.postprocess_enabled)}
              onChange={(checked) => onSetConfig({ postprocess_enabled: checked })}
            />
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
          </ConsoleSection>

          <ConsoleSection title="母带处理" meta={`${Number(config.target_lufs ?? -16)} LUFS`}>
            <div className="consoleSwitchGrid">
              <SwitchRow
                title="响度归一化"
                description="目标 LUFS"
                checked={Boolean(config.loudness_normalize)}
                onChange={(checked) => onSetConfig({ loudness_normalize: checked })}
              />
              <SwitchRow
                title="静音裁剪"
                description="裁剪首尾静音"
                checked={Boolean(config.trim_silence_enabled)}
                onChange={(checked) => onSetConfig({ trim_silence_enabled: checked })}
              />
            </div>
            <Slider
              label="目标 LUFS"
              value={[Number(config.target_lufs ?? -16)]}
              onValueChange={([v]) => onSetConfig({ target_lufs: v })}
              min={-24}
              max={-10}
              step={1}
            />
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
            <div className="consoleFieldGrid">
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
          </ConsoleSection>

          <ConsoleSection title="章节标记" meta={hasPendingChapterPostprocess ? `${chapterMarkers.length} 个 · 未处理` : `${chapterMarkers.length} 个`}>
            <div className="listStack">
              {hasPendingChapterPostprocess ? (
                <div className="postprocessPendingNotice" role="status">
                  <AlertTriangle aria-hidden="true" focusable="false" size={15} />
                  <div>
                    <strong>有未处理后期</strong>
                    <span>{pendingChapterPostprocessText}</span>
                  </div>
                </div>
              ) : null}
              {chapterMarkers.map((item) => (
                <div key={item.id} className="chapterMarkerRow">
                  <div className="formGroup chapterTitleField">
                    <label className="formLabel" htmlFor={`chapter-title-${item.id}`}>章节名</label>
                    <input
                      id={`chapter-title-${item.id}`}
                      name={`chapter-title-${item.id}`}
                      className="input"
                      value={item.title || ""}
                      onChange={(e) => updateChapterMarker(item.id, { title: e.target.value })}
                      autoComplete="off"
                      placeholder="章节标题…"
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
          </ConsoleSection>

          <ConsoleSection title="音乐和音效" meta={`${musicTracks.length + effectTracks.length} 条轨道`}>
            <div className="postprocessTrackActions">
              <Button
                variant="secondary"
                size="sm"
                icon={AudioLines}
                onClick={() => onExtractBackground?.()}
                disabled={isRunning || !currentProject?.id || !hasSourceAudio}
              >
                提取为音效
              </Button>
              {!hasSourceAudio ? <span className="muted">没有可用原音频</span> : null}
            </div>
            <input
              ref={musicInputRef}
              type="file"
              name="music-track-upload"
              aria-label="上传音乐"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUploadPostprocessAsset?.("music", file);
              }}
            />
            <input
              ref={effectInputRef}
              type="file"
              name="effect-track-upload"
              aria-label="上传音效"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUploadPostprocessAsset?.("effect", file);
              }}
            />
            <div className="postprocessTrackBoard">
              {renderTrackList("music", musicTracks)}
              {renderTrackList("effect", effectTracks)}
            </div>
          </ConsoleSection>

          <div className="controlRow synthesisConsoleActionRow">
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
