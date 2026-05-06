import { useEffect, useMemo, useState } from "react";
import { Archive, CircleAlert, CircleCheckBig, Download } from "lucide-react";

import { Dialog, DialogContent } from "../ui/Dialog";
import Button from "../ui/Button";

const PRESETS = [
  {
    id: "audiobook",
    title: "听书成品",
    description: "适合分发收听：音频、章节、元数据、字幕",
  },
  {
    id: "editing",
    title: "剪辑工程",
    description: "适合剪映/PR：音频、字幕、标记、时间戳清单",
  },
  {
    id: "backup",
    title: "备份归档",
    description: "完整工程归档 ZIP，可后续重新导入",
  },
  {
    id: "data",
    title: "数据分析",
    description: "结构化脚本与时间轴清单，便于分析处理",
  },
];

function buildPresetPreview({ presetId, availability }) {
  if (presetId === "backup") {
    return {
      included: ["完整工程 ZIP（项目/音频/字幕/预设/扩展导出）"],
      missing: [],
    };
  }
  if (presetId === "audiobook") {
    return {
      included: [
        "完整音频（WAV/MP3）",
        "章节清单（JSON）",
        "播客元数据（Podcast/Audible）",
        "FFMetadata",
      ],
      missing: [
        !availability.hasSrt ? "字幕 SRT 缺失" : "",
        !availability.hasProcessedChapters ? "章节音频缺失（先执行后期并设置章节）" : "",
      ].filter(Boolean),
    };
  }
  if (presetId === "editing") {
    return {
      included: [
        "完整音频 WAV",
        "字幕（SRT/LRC）",
        "剪映 CSV / PR 标记 CSV",
        "时间戳清单（JSON/CSV）",
      ],
      missing: [
        !availability.hasSrt ? "字幕 SRT 缺失" : "",
        !availability.hasLrc ? "字幕 LRC 缺失" : "",
      ].filter(Boolean),
    };
  }
  return {
    included: [
      "剧本（JSON/CSV）",
      "时间戳清单（JSON/CSV）",
      "章节清单（JSON/CSV）",
      "元数据（Podcast/Audible）",
    ],
    missing: [],
  };
}

export default function ExportWizardDialog({
  open,
  onOpenChange,
  API_ORIGIN,
  currentProject,
  audioVariant = "raw",
}) {
  const projectId = currentProject?.id || "";
  const [selectedPreset, setSelectedPreset] = useState("audiobook");
  const [selectedVariant, setSelectedVariant] = useState(audioVariant === "processed" ? "processed" : "raw");

  const availability = useMemo(() => {
    const assets = currentProject?.audio_assets || {};
    return {
      hasRawAudio: Boolean(assets.full_wav_relpath || assets.full_mp3_relpath),
      hasProcessedAudio: Boolean(assets.processed?.full_wav_relpath || assets.processed?.full_mp3_relpath),
      hasSrt: Boolean(assets.subtitle_srt_relpath),
      hasLrc: Boolean(assets.subtitle_lrc_relpath),
      hasProcessedChapters: Array.isArray(assets.processed?.chapters) && assets.processed.chapters.length > 0,
    };
  }, [currentProject]);

  useEffect(() => {
    const preferred = audioVariant === "processed" ? "processed" : "raw";
    if (preferred === "processed" && !availability.hasProcessedAudio) {
      setSelectedVariant("raw");
      return;
    }
    if (preferred === "raw" && !availability.hasRawAudio && availability.hasProcessedAudio) {
      setSelectedVariant("processed");
      return;
    }
    setSelectedVariant(preferred);
  }, [audioVariant, availability.hasProcessedAudio, availability.hasRawAudio, open]);

  const preview = useMemo(
    () => buildPresetPreview({ presetId: selectedPreset, availability }),
    [selectedPreset, availability]
  );

  const downloadUrl = useMemo(() => {
    if (!projectId) {
      return "";
    }
    if (selectedPreset === "backup") {
      return `${API_ORIGIN}/api/v1/tts/export/${projectId}/archive`;
    }
    return `${API_ORIGIN}/api/v1/tts/export/wizard?project_id=${projectId}&preset=${encodeURIComponent(selectedPreset)}&variant=${encodeURIComponent(selectedVariant)}`;
  }, [API_ORIGIN, projectId, selectedPreset, selectedVariant]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="导出向导"
        description="选择导出目标，系统会自动打包为单个 ZIP 文件。"
        className="exportWizardDialog"
      >
        <div className="controlRow" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <div className="muted">导出变体</div>
          <div className="controlRow">
            <Button
              variant={selectedVariant === "raw" ? "primary" : "secondary"}
              size="sm"
              disabled={!availability.hasRawAudio}
              onClick={() => setSelectedVariant("raw")}
            >
              raw
            </Button>
            <Button
              variant={selectedVariant === "processed" ? "primary" : "secondary"}
              size="sm"
              disabled={!availability.hasProcessedAudio}
              onClick={() => setSelectedVariant("processed")}
            >
              processed
            </Button>
          </div>
        </div>

        <div className="listStack">
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`statRow statRowButton ${selectedPreset === preset.id ? "active" : ""}`}
              onClick={() => setSelectedPreset(preset.id)}
            >
              <span>{preset.title}</span>
              <strong>{preset.description}</strong>
            </button>
          ))}
        </div>

        <div className="exportWizardPreview">
          <div className="listStack">
            <div className="muted">将包含</div>
            {preview.included.map((item) => (
              <div key={`in-${item}`} className="controlRow exportWizardRow ok">
                <CircleCheckBig size={14} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="listStack">
            <div className="muted">缺失/跳过</div>
            {preview.missing.length ? preview.missing.map((item) => (
              <div key={`miss-${item}`} className="controlRow exportWizardRow warn">
                <CircleAlert size={14} />
                <span>{item}</span>
              </div>
            )) : (
              <div className="controlRow exportWizardRow ok">
                <CircleCheckBig size={14} />
                <span>无</span>
              </div>
            )}
          </div>
        </div>

        <div className="controlRow" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            <Button
              variant="primary"
              icon={selectedPreset === "backup" ? Archive : Download}
              disabled={!projectId}
            >
              下载导出包
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
