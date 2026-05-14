import { ChevronDown, ChevronUp, Pause, Play, SlidersHorizontal, Square, Trash2, Upload, Wand2 } from "lucide-react";
import { useRef, useState } from "react";

import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Slider from "../ui/Slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { useI18n } from "../../i18n/I18nProvider";

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
  selectedSegmentCount = 0,
  isRunning,
  error,
  onSetConfig,
  onApplySegmentSpeed,
  onStart,
  onCancel,
  isDubbingSourceProject = false,
}) {
  const { t } = useI18n();
  const [speedDraft, setSpeedDraft] = useState("1.0");
  const requestedBackend = config.tts_backend || "omnivoice";
  const ttsBackend = requestedBackend;
  const showTimelineLock = ttsBackend !== "voxcpm2";
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
        title={t("synth.config.generate.title")}
        subtitle={expanded ? t("synth.config.generate.subtitleExpanded") : t("synth.config.collapsedHint")}
        icon={SlidersHorizontal}
      />
      {!expanded ? (
        <div className="muted">{t("synth.config.collapsed")}</div>
      ) : (
        <>
          <Tabs value={ttsBackend} onValueChange={(value) => onSetConfig({ tts_backend: value })}>
            <TabsList>
              <TabsTrigger value="omnivoice">OmniVoice</TabsTrigger>
              <TabsTrigger value="voxcpm2">VoxCPM2</TabsTrigger>
            </TabsList>

            <TabsContent value="omnivoice">
              <Slider
                label={t("synth.config.numStep")}
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
                label={t("synth.config.guidanceScale")}
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
                <label className="formLabel">{t("synth.config.denoise")}</label>
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
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.enableDenoise")}</span>
                </label>
              </div>
            </TabsContent>

            <TabsContent value="voxcpm2">
              {isDubbingSourceProject ? (
                <div className="statusBadge warning" style={{ marginBottom: 10, display: "block", textAlign: "left" }}>
                  {t("synth.config.voxWarning")}
                </div>
              ) : null}
              <Slider
                label={t("synth.config.inferenceTimesteps")}
                value={[Number(voxcpm2Config.inference_timesteps)]}
                onValueChange={([v]) => onSetConfig({ voxcpm2: { ...voxcpm2Config, inference_timesteps: v } })}
                min={4}
                max={30}
                step={1}
              />
              <Slider
                label={t("synth.config.cfgValue")}
                value={[Number(voxcpm2Config.cfg_value)]}
                onValueChange={([v]) => onSetConfig({ voxcpm2: { ...voxcpm2Config, cfg_value: v } })}
                min={1}
                max={3}
                step={0.1}
              />
              <div className="editorGrid">
                <div className="formGroup">
                  <label className="formLabel">{t("synth.config.denoise")}</label>
                  <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(voxcpm2Config.denoise)}
                      onChange={(e) => onSetConfig({ voxcpm2: { ...voxcpm2Config, denoise: e.target.checked } })}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                    />
                    <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.enableDenoise")}</span>
                  </label>
                </div>
                <div className="formGroup">
                  <label className="formLabel">{t("synth.config.textNormalize")}</label>
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
            label={t("synth.config.gapDuration")}
            value={[Number(config.gap_duration_ms)]}
            onValueChange={([v]) => onSetConfig({ gap_duration_ms: v })}
            min={0}
            max={2000}
            step={100}
            unit="ms"
          />

          {ttsBackend !== "voxcpm2" ? (
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.segmentSpeedBatch")}</label>
              <div className="controlRow" style={{ alignItems: "center" }}>
                <input
                  className="textInput"
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={speedDraft}
                  onChange={(event) => setSpeedDraft(event.target.value)}
                  style={{ maxWidth: 140 }}
                />
                <Button
                  variant="secondary"
                  disabled={isRunning || !currentProject?.id || !currentProject?.script?.segments?.length}
                  onClick={() => onApplySegmentSpeed?.(Number(speedDraft), "all")}
                >
                  {t("synth.config.applyAllSegments")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={isRunning || !selectedSegmentCount}
                  onClick={() => onApplySegmentSpeed?.(Number(speedDraft), "selected")}
                >
                  {t("synth.config.applySelectedSegments")}{selectedSegmentCount ? ` (${selectedSegmentCount})` : ""}
                </Button>
              </div>
              <div className="muted">
                {t("synth.config.segmentSpeedHint")}
              </div>
            </div>
          ) : null}

          {showTimelineLock ? (
          <div className="formGroup">
            <label className="formLabel">{t("synth.config.timelineLock")}</label>
            <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
              <input
                type="checkbox"
                checked={Boolean(config.timeline_lock_enabled)}
                onChange={(e) => onSetConfig({ timeline_lock_enabled: e.target.checked })}
                style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
              />
              <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                {t("synth.config.timelineLockHint")}
              </span>
            </label>
          </div>
          ) : null}

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.outputFormat")}</label>
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
              <label className="formLabel">{t("synth.config.autoRetry")}</label>
              <label className="controlRow" style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.tts_auto_retry ?? true)}
                  onChange={(e) => onSetConfig({ tts_auto_retry: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.autoRetryHint")}</span>
              </label>
            </div>
          </div>

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.retryAttempts")}</label>
              <Select
                value={String(config.tts_retry_attempts ?? 2)}
                onValueChange={(value) => onSetConfig({ tts_retry_attempts: Number(value) })}
                options={[
                  { value: "0", label: t("synth.config.retry0") },
                  { value: "1", label: t("synth.config.retry1") },
                  { value: "2", label: t("synth.config.retry2") },
                  { value: "3", label: t("synth.config.retry3") },
                ]}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.segmentConcurrency")}</label>
              <Select
                value={String(config.tts_segment_concurrency ?? 1)}
                onValueChange={(value) => onSetConfig({ tts_segment_concurrency: Number(value) })}
                options={[
                  { value: "1", label: t("synth.config.concurrency1") },
                  { value: "2", label: t("synth.config.concurrency2") },
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
              {isRunning ? t("synth.saving") : t("synth.action.start")}
            </Button>
            {isRunning ? <Button variant="danger" icon={Square} onClick={onCancel}>{t("synth.status.stopTask")}</Button> : null}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {currentProject ? currentProject.name : t("project.unselected")}
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
  const { t } = useI18n();
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
    label: `#${index + 1} ${(segment.text || "").slice(0, 18) || t("synth.config.emptySegment")}`,
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
        { id: markerId, title: t("synth.config.post.chapterDefaultTitle", { index: chapterMarkers.length + 1 }), start_segment_id: firstSegmentId },
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
        title={t("synth.config.post.title")}
        subtitle={expanded ? t("synth.config.post.subtitleExpanded") : t("synth.config.collapsedHint")}
        icon={Wand2}
      />
      {!expanded ? (
        <div className="muted">{t("synth.config.collapsed")}</div>
      ) : (
        <>
          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.post.enable")}</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.postprocess_enabled)}
                  onChange={(e) => onSetConfig({ postprocess_enabled: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.enableHint")}</span>
              </label>
            </div>
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.post.mp3Bitrate")}</label>
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
              <label className="formLabel">{t("synth.config.post.loudnessNormalize")}</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.loudness_normalize)}
                  onChange={(e) => onSetConfig({ loudness_normalize: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.targetLufsShort")}</span>
              </label>
              <Slider
                label={t("synth.config.post.targetLufs")}
                value={[Number(config.target_lufs ?? -16)]}
                onValueChange={([v]) => onSetConfig({ target_lufs: v })}
                min={-24}
                max={-10}
                step={1}
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">{t("synth.config.post.trimSilence")}</label>
              <label className="controlRow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.trim_silence_enabled)}
                  onChange={(e) => onSetConfig({ trim_silence_enabled: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.trimSilenceHint")}</span>
              </label>
              <Slider
                label={t("synth.config.post.trimThreshold")}
                value={[Number(config.trim_threshold_db ?? -45)]}
                onValueChange={([v]) => onSetConfig({ trim_threshold_db: v })}
                min={-70}
                max={-20}
                step={1}
              />
              <Slider
                label={t("synth.config.post.minSilenceBlock")}
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
              label={t("synth.config.post.fadeIn")}
              value={[Number(config.fade_in_ms ?? 40)]}
              onValueChange={([v]) => onSetConfig({ fade_in_ms: v })}
              min={0}
              max={1500}
              step={10}
              unit="ms"
            />
            <Slider
              label={t("synth.config.post.fadeOut")}
              value={[Number(config.fade_out_ms ?? 80)]}
              onValueChange={([v]) => onSetConfig({ fade_out_ms: v })}
              min={0}
              max={2000}
              step={10}
              unit="ms"
            />
          </div>

          <div className="formGroup">
            <label className="formLabel">{t("synth.config.post.chapterMarkers")}</label>
            <div className="listStack">
              {chapterMarkers.map((item) => (
                <div key={item.id} className="editorGrid" style={{ alignItems: "end" }}>
                  <div className="formGroup">
                    <label className="formLabel">{t("synth.config.post.chapterName")}</label>
                    <input
                      className="input"
                      value={item.title || ""}
                      onChange={(e) => updateChapterMarker(item.id, { title: e.target.value })}
                      placeholder={t("synth.config.post.chapterTitlePlaceholder")}
                    />
                  </div>
                  <div className="formGroup">
                    <label className="formLabel">{t("synth.config.post.startSegment")}</label>
                    <Select
                      value={item.start_segment_id || ""}
                      onValueChange={(value) => updateChapterMarker(item.id, { start_segment_id: value })}
                      options={segmentOptions}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeChapterMarker(item.id)}>{t("common.delete")}</Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={addChapterMarker} disabled={!segmentOptions.length}>
                {t("synth.config.post.addChapterMarker")}
              </Button>
            </div>
          </div>

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">{t("synth.config.post.bgm")}</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  onClick={() => bgmInputRef.current?.click()}
                  disabled={isUploadingPostAsset}
                >
                  {isUploadingPostAsset ? t("music.uploading") : t("synth.config.post.uploadBgm")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onClearPostprocessAsset?.("bgm")}
                  disabled={isUploadingPostAsset || !config.bgm_track?.relpath}
                >
                  {t("common.delete")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={previewPlayingType === "bgm" ? Pause : Play}
                  onClick={() => togglePreview("bgm")}
                  disabled={isUploadingPostAsset || !config.bgm_track?.relpath || !bgmPreviewUrl}
                >
                  {previewPlayingType === "bgm" ? t("common.pause") : t("common.play")}
                </Button>
                <span className="muted" style={{ fontSize: 12 }}>{config.bgm_track?.relpath || t("synth.config.post.unbound")}</span>
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
                label={t("synth.config.post.bgmGain")}
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
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.loop")}</span>
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
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.enableDucking")}</span>
                </label>
              </div>
              <Slider
                label={t("synth.config.post.duckingDb")}
                value={[Number(config.bgm_track?.ducking_db ?? 8)]}
                onValueChange={([v]) => onSetConfig({ bgm_track: { ...(config.bgm_track || {}), ducking_db: v } })}
                min={0}
                max={24}
                step={1}
              />
            </div>

            <div className="formGroup">
              <label className="formLabel">{t("synth.config.post.ambience")}</label>
              <div className="controlRow">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  onClick={() => ambienceInputRef.current?.click()}
                  disabled={isUploadingPostAsset}
                >
                  {isUploadingPostAsset ? t("music.uploading") : t("synth.config.post.uploadAmbience")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onClearPostprocessAsset?.("ambience")}
                  disabled={isUploadingPostAsset || !config.ambience_track?.relpath}
                >
                  {t("common.delete")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={previewPlayingType === "ambience" ? Pause : Play}
                  onClick={() => togglePreview("ambience")}
                  disabled={isUploadingPostAsset || !config.ambience_track?.relpath || !ambiencePreviewUrl}
                >
                  {previewPlayingType === "ambience" ? t("common.pause") : t("common.play")}
                </Button>
                <span className="muted" style={{ fontSize: 12 }}>{config.ambience_track?.relpath || t("synth.config.post.unbound")}</span>
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
                label={t("synth.config.post.ambienceGain")}
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
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t("synth.config.post.loop")}</span>
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
              {t("synth.action.postprocess")}
            </Button>
            {!hasRawFullAudio ? <span className="muted" style={{ fontSize: 12 }}>{t("synth.config.post.needRawAudioHint")}</span> : null}
          </div>
        </>
      )}
    </GlassCard>
  );
}
