import { useEffect, useMemo, useState } from "react";
import { Archive, CircleAlert, CircleCheckBig, Download } from "lucide-react";

import { Dialog, DialogContent } from "../ui/Dialog";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nProvider";

const PRESETS = [
  { id: "audiobook" },
  { id: "editing" },
  { id: "backup" },
  { id: "data" },
];

function buildPresetPreview({ presetId, availability, t }) {
  if (presetId === "backup") {
    return {
      included: [t("synth.export.preview.backupZip")],
      missing: [],
    };
  }
  if (presetId === "audiobook") {
    return {
      included: [
        t("synth.export.preview.fullAudio"),
        t("synth.export.preview.chaptersJson"),
        t("synth.export.preview.podcastMetadata"),
        "FFMetadata",
      ],
      missing: [
        !availability.hasSrt ? t("synth.export.missing.srt") : "",
        !availability.hasProcessedChapters ? t("synth.export.missing.chapterAudio") : "",
      ].filter(Boolean),
    };
  }
  if (presetId === "editing") {
    return {
      included: [
        t("synth.export.preview.fullAudioWav"),
        t("synth.export.preview.subtitles"),
        t("synth.export.preview.capcutPr"),
        t("synth.export.preview.timestampManifest"),
      ],
      missing: [
        !availability.hasSrt ? t("synth.export.missing.srt") : "",
        !availability.hasLrc ? t("synth.export.missing.lrc") : "",
      ].filter(Boolean),
    };
  }
  return {
    included: [
      t("synth.export.preview.script"),
      t("synth.export.preview.timestampManifest"),
      t("synth.export.preview.chapters"),
      t("synth.export.preview.metadata"),
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
  const { t } = useI18n();
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
    () => buildPresetPreview({ presetId: selectedPreset, availability, t }),
    [selectedPreset, availability, t]
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
        title={t("synth.status.exportWizard")}
        description={t("synth.export.description")}
        className="exportWizardDialog"
      >
        <div className="controlRow" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <div className="muted">{t("synth.export.variant")}</div>
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
              <span>{t(`synth.export.preset.${preset.id}.title`)}</span>
              <strong>{t(`synth.export.preset.${preset.id}.description`)}</strong>
            </button>
          ))}
        </div>

        <div className="exportWizardPreview">
          <div className="listStack">
            <div className="muted">{t("synth.export.includes")}</div>
            {preview.included.map((item) => (
              <div key={`in-${item}`} className="controlRow exportWizardRow ok">
                <CircleCheckBig size={14} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="listStack">
            <div className="muted">{t("synth.export.missing")}</div>
            {preview.missing.length ? preview.missing.map((item) => (
              <div key={`miss-${item}`} className="controlRow exportWizardRow warn">
                <CircleAlert size={14} />
                <span>{item}</span>
              </div>
            )) : (
              <div className="controlRow exportWizardRow ok">
                <CircleCheckBig size={14} />
                <span>{t("common.none")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="controlRow" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
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
              {t("synth.export.downloadPackage")}
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
