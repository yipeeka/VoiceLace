import { Mic, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import AudioPlayer from "../components/shared/AudioPlayer";
import CharacterBadge from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import FileDropZone from "../components/shared/FileDropZone";
import GlassCard from "../components/shared/GlassCard";
import Button from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Dialog";
import Select from "../components/ui/Select";
import Slider from "../components/ui/Slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { useProjectStore } from "../stores/useProjectStore";
import { useVoiceStore } from "../stores/useVoiceStore";

const GENDER_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "female", label: "Female（女声）" },
  { value: "male", label: "Male（男声）" },
];

const AGE_OPTIONS = [
  { value: "",        label: "未指定" },
  { value: "child",  label: "Child（儿童）" },
  { value: "young",  label: "Young（青年）" },
  { value: "middle", label: "Middle-aged（中年）" },
  { value: "old",    label: "Old（老年）" },
];

const PITCH_OPTIONS = [
  { value: "",      label: "未指定" },
  { value: "low",   label: "Low（低沉）" },
  { value: "medium", label: "Medium（适中）" },
  { value: "high",  label: "High（高亢）" },
];

const STYLE_OPTIONS = [
  { value: "",          label: "未指定" },
  { value: "calm",      label: "Calm（平静）" },
  { value: "gentle",    label: "Gentle（温柔）" },
  { value: "assertive", label: "Assertive（坚定）" },
  { value: "lively",    label: "Lively（活泼）" },
  { value: "whisper",   label: "Whisper（低语）" },
  { value: "dramatic",  label: "Dramatic（戏剧）" },
];

const emptyForm = {
  name: "",
  voice_mode: "design",
  description: "",
  gender: "",
  age: "",
  pitch: "",
  style: "",
  accent: "",
  dialect: "",
  custom_instruct: "",
  speed: 1.0,
};

export default function VoiceConfigPage() {
  const { currentProject, refreshCurrentProject } = useProjectStore();
  const {
    presets, assignments, previewAudioUrl,
    isLoading, isSaving, error,
    setAssignments, assignVoice, loadPresets,
    createPreset, updatePreset, deletePreset, saveAssignments, previewVoice,
    uploadReferenceAudio, transcribeAudio, uploadedRefAudioPath, transcribedRefText,
  } = useVoiceStore();

  const [form, setForm] = useState({ ...emptyForm });
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [sampleText, setSampleText] = useState("这是试听文本，用于确认角色声音风格。");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    loadPresets().catch(() => undefined);
  }, [loadPresets]);

  useEffect(() => {
    setAssignments(currentProject?.voice_assignments || {});
  }, [currentProject, setAssignments]);

  const characters = currentProject?.script?.characters || [];
  const presetOptions = useMemo(
    () => [{ value: "", label: "未分配" }, ...presets.map((p) => ({ value: p.id, label: p.name }))],
    [presets]
  );
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const isEditMode = Boolean(selectedPresetId && selectedPreset);

  useEffect(() => {
    if (!selectedPreset) {
      return;
    }
    setForm({
      ...emptyForm,
      ...selectedPreset,
      speed: Number(selectedPreset.speed ?? 1),
    });
    useVoiceStore.setState({
      uploadedRefAudioPath: selectedPreset.ref_audio_path || "",
      transcribedRefText: selectedPreset.ref_text || "",
    });
  }, [selectedPreset]);

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function buildPresetPayload() {
    const payload = {
      ...form,
      name: form.name.trim(),
      speed: Number(form.speed) || 1,
    };
    if (payload.voice_mode === "clone") {
      payload.ref_audio_path = uploadedRefAudioPath || null;
      payload.ref_text = transcribedRefText || null;
    } else {
      payload.ref_audio_path = null;
      payload.ref_text = null;
    }
    return payload;
  }

  async function handleSavePreset() {
    if (!form.name.trim()) return;
    const payload = buildPresetPayload();
    const preset = isEditMode
      ? await updatePreset(selectedPresetId, payload)
      : await createPreset(payload);
    setForm({ ...emptyForm });
    useVoiceStore.setState({ uploadedRefAudioPath: "", transcribedRefText: "" });
    setSelectedPresetId(preset.id);
  }

  async function handleSaveAssignments() {
    if (!currentProject?.id) return;
    await saveAssignments(currentProject.id);
    await refreshCurrentProject(currentProject.id);
  }

  async function handlePreview() {
    if (!selectedPreset) return;
    await previewVoice({ preset: selectedPreset, text: sampleText });
  }

  async function handleRefAudioUpload(file) {
    await uploadReferenceAudio(file);
  }

  async function handleTranscribe() {
    if (!uploadedRefAudioPath) return;
    await transcribeAudio(uploadedRefAudioPath);
  }

  return (
    <div className="pageGrid twoCols">
      {/* LEFT: Preset management */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* New preset form */}
        <GlassCard>
          <h2 className="cardTitle"><Mic size={16} /> 新建声音预设</h2>

          <div className="editorGrid">
            <input
              className="textInput"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="预设名称（必填）"
              onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
            />
            <Select
              value={form.voice_mode}
              onValueChange={(v) => setField("voice_mode", v)}
              options={[
                { value: "design", label: "Design（声音设计）" },
                { value: "clone",  label: "Clone（声音克隆）" },
                { value: "auto",   label: "Auto（自动）" },
              ]}
            />
          </div>

          <Tabs defaultValue="design" value={form.voice_mode} onValueChange={(v) => setField("voice_mode", v)}>
            <TabsList>
              <TabsTrigger value="design">声音设计</TabsTrigger>
              <TabsTrigger value="clone">声音克隆</TabsTrigger>
              <TabsTrigger value="auto">自动</TabsTrigger>
            </TabsList>

            <TabsContent value="design" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
              <div className="editorGrid">
                <div className="formGroup">
                  <label className="formLabel">性别</label>
                  <Select value={form.gender} onValueChange={(v) => setField("gender", v)} options={GENDER_OPTIONS} placeholder="未指定" />
                </div>
                <div className="formGroup">
                  <label className="formLabel">年龄</label>
                  <Select value={form.age} onValueChange={(v) => setField("age", v)} options={AGE_OPTIONS} placeholder="未指定" />
                </div>
              </div>
              <div className="editorGrid">
                <div className="formGroup">
                  <label className="formLabel">音调</label>
                  <Select value={form.pitch} onValueChange={(v) => setField("pitch", v)} options={PITCH_OPTIONS} placeholder="未指定" />
                </div>
                <div className="formGroup">
                  <label className="formLabel">风格</label>
                  <Select value={form.style} onValueChange={(v) => setField("style", v)} options={STYLE_OPTIONS} placeholder="未指定" />
                </div>
              </div>
              <div className="formGroup">
                <label className="formLabel">自定义描述</label>
                <textarea
                  className="textArea compactArea"
                  value={form.custom_instruct}
                  onChange={(e) => setField("custom_instruct", e.target.value)}
                  placeholder="例如：说话温柔，略带忧伤的年轻女性，有古典气质"
                />
              </div>
            </TabsContent>

            <TabsContent value="clone" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
              <FileDropZone
                accept="audio/*"
                onFile={handleRefAudioUpload}
                label="上传参考音频"
                sublabel="支持 MP3 / WAV / FLAC，建议 3-30 秒"
              />
              {uploadedRefAudioPath && (
                <div className="controlRow">
                  <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ✓ {uploadedRefAudioPath.split(/[\\/]/).pop()}
                  </span>
                  <Button variant="secondary" size="sm" onClick={handleTranscribe} disabled={isSaving}>
                    ASR 转写
                  </Button>
                </div>
              )}
              <div className="formGroup">
                <label className="formLabel">参考文本（转写或手动输入）</label>
                <textarea
                  className="textArea compactArea"
              value={transcribedRefText}
              onChange={(e) => useVoiceStore.setState({ transcribedRefText: e.target.value })}
              placeholder="参考音频的对应文本内容..."
            />
              </div>
            </TabsContent>

            <TabsContent value="auto" style={{ paddingTop: 12 }}>
              <p className="muted">Auto 模式下，TTS 将使用模型默认声音，无需额外配置。</p>
            </TabsContent>
          </Tabs>

          <Slider
            label="语速"
            value={[Number(form.speed)]}
            onValueChange={([v]) => setField("speed", v)}
            min={0.5}
            max={2.0}
            step={0.05}
            unit="x"
          />

          <div className="formGroup">
            <label className="formLabel">描述（可选）</label>
            <textarea
              className="textArea compactArea"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="记录这个声音适合的角色气质..."
            />
          </div>

          <div className="controlRow">
            <Button
              variant="primary"
              icon={Plus}
              disabled={isSaving || !form.name.trim()}
              onClick={handleSavePreset}
            >
              {isSaving ? "保存中..." : isEditMode ? "更新预设" : "创建预设"}
            </Button>
            {isEditMode ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedPresetId(null);
                  setForm({ ...emptyForm });
                  useVoiceStore.setState({ uploadedRefAudioPath: "", transcribedRefText: "" });
                }}
              >
                取消编辑
              </Button>
            ) : null}
            <span className="muted">
              {isLoading ? "加载中..." : `已有 ${presets.length} 个预设`}
            </span>
          </div>

          {error && <div className="errorText">⚠ {error}</div>}
        </GlassCard>

        {/* Preset grid */}
        <GlassCard>
          <h2 className="cardTitle">声音预设</h2>
          {presets.length ? (
            <div className="presetGrid">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={`presetCard ${selectedPresetId === preset.id ? "selected" : ""}`}
                  onClick={() => {
                    if (preset.id === selectedPresetId) {
                      setSelectedPresetId(null);
                      setForm({ ...emptyForm });
                      useVoiceStore.setState({ uploadedRefAudioPath: "", transcribedRefText: "" });
                      return;
                    }
                    setSelectedPresetId(preset.id);
                  }}
                >
                  <div className="presetAvatar">
                    {preset.gender === "female" ? "♀" : preset.gender === "male" ? "♂" : "🎙"}
                  </div>
                  <div className="presetName" title={preset.name}>{preset.name}</div>
                  <span className={`presetModeBadge ${preset.voice_mode}`}>{preset.voice_mode}</span>
                  <div className="controlRow" style={{ marginTop: 4 }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setSampleText("这是试听文本"); setSelectedPresetId(preset.id); handlePreview(); }}
                    >
                      试听
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={Trash2}
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(preset.id); }}
                    />
                  </div>
                </div>
              ))}
              {/* Add new card */}
              <div
                className="presetCard"
                style={{ borderStyle: "dashed", cursor: "pointer", alignItems: "center", justifyContent: "center", minHeight: 140 }}
                onClick={() => {
                  setSelectedPresetId(null);
                  setForm({ ...emptyForm });
                  useVoiceStore.setState({ uploadedRefAudioPath: "", transcribedRefText: "" });
                }}
              >
                <Plus size={24} style={{ color: "var(--text-muted)" }} />
                <span className="muted">新建预设</span>
              </div>
            </div>
          ) : (
            <EmptyState
              title="还没有声音预设"
              description="在上方表单中填写并点击「创建预设」"
            />
          )}
        </GlassCard>
      </div>

      {/* RIGHT: Assignment + preview */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Preview player */}
        {selectedPreset && (
          <GlassCard>
            <h2 className="cardTitle">试听预览 · {selectedPreset.name}</h2>
            <textarea
              className="textArea compactArea"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
            />
            <div className="controlRow">
              <Button variant="primary" onClick={handlePreview} disabled={isSaving}>
                {isSaving ? "合成中..." : "▶ 试听"}
              </Button>
            </div>
            {previewAudioUrl && <AudioPlayer audioUrl={previewAudioUrl} />}
          </GlassCard>
        )}

        {/* Character assignment */}
        <GlassCard>
          <h2 className="cardTitle">角色分配</h2>
          <p className="cardSubtitle">为项目中每个角色选择对应的声音预设。</p>

          {characters.length ? (
            <div className="listStack">
              {characters.map((char) => (
                <div key={char.name} className="statRow" style={{ gap: 12, flexWrap: "wrap" }}>
                  <CharacterBadge name={char.name} />
                  <span className="muted" style={{ marginRight: "auto" }}>出场 {char.appearance_count} 次</span>
                  <div style={{ minWidth: 180 }}>
                    <Select
                      value={assignments[char.name] || ""}
                      onValueChange={(v) => assignVoice(char.name, v)}
                      options={presetOptions}
                      placeholder="未分配"
                    />
                  </div>
                </div>
              ))}
              <div className="controlRow" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                <Button
                  variant="primary"
                  disabled={!currentProject?.id || isSaving}
                  onClick={handleSaveAssignments}
                >
                  保存角色分配
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="当前项目无角色"
              description="请先在「文本输入」完成 LLM 解析"
            />
          )}
        </GlassCard>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="删除声音预设"
        description="此操作不可撤销，所有使用该预设的角色分配也将被清除。"
        onConfirm={() => { deletePreset(deleteTarget); setDeleteTarget(null); if (selectedPresetId === deleteTarget) setSelectedPresetId(null); }}
        danger
      />
    </div>
  );
}
