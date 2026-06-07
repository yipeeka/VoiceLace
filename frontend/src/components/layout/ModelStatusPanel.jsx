import { Brain, ChevronLeft, ChevronRight, Database, HardDrive, Music, RefreshCw, Trash2, Volume2, Waves } from "lucide-react";
import { useMemo, useState } from "react";

import Button from "../ui/Button";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUiStore } from "../../stores/useUiStore";

const STATUS_LABELS = {
  idle: "空闲",
  ready: "就绪",
  loading: "加载中",
  unloading: "卸载中",
  error: "错误",
};

function resolveStatus(status, loaded, error) {
  if (status) return status;
  if (error) return "error";
  return loaded ? "ready" : "idle";
}

function statusTone(status) {
  if (status === "ready") return "ready";
  if (status === "error") return "error";
  if (status === "loading" || status === "unloading") return "loading";
  return "idle";
}

export default function ModelStatusPanel() {
  const systemStatus = useSettingsStore((state) => state.systemStatus);
  const refreshSystemStatus = useSettingsStore((state) => state.refreshSystemStatus);
  const manualUnloadLLM = useSettingsStore((state) => state.manualUnloadLLM);
  const manualUnloadTTS = useSettingsStore((state) => state.manualUnloadTTS);
  const manualUnloadASR = useSettingsStore((state) => state.manualUnloadASR);
  const manualUnloadMusic = useSettingsStore((state) => state.manualUnloadMusic);
  const manualUnloadAll = useSettingsStore((state) => state.manualUnloadAll);
  const [busyKey, setBusyKey] = useState("");
  const [collapsed, setCollapsed] = useState(true);

  const models = useMemo(() => {
    const llmStatus = resolveStatus(systemStatus?.llm_status, systemStatus?.llm_loaded, systemStatus?.llm_error);
    const asrStatus = resolveStatus(systemStatus?.asr_status, systemStatus?.asr_loaded, systemStatus?.asr_error);
    const ttsStatus = resolveStatus(systemStatus?.tts_status, systemStatus?.tts_loaded, systemStatus?.tts_error);
    const musicStatus = resolveStatus(systemStatus?.music_status, systemStatus?.music_loaded, systemStatus?.music_error);
    return [
      {
        key: "llm",
        label: "LLM 模型",
        detail: systemStatus?.llm_backend || systemStatus?.config?.llm_backend || "本地",
        status: llmStatus,
        icon: Brain,
        unload: manualUnloadLLM,
      },
      {
        key: "asr",
        label: "ASR 模型",
        detail: systemStatus?.asr_backend || systemStatus?.config?.asr_backend || "Whisper",
        status: asrStatus,
        icon: Waves,
        unload: manualUnloadASR,
      },
      {
        key: "tts",
        label: "TTS 模型",
        detail: systemStatus?.tts_backend || "OmniVoice / VoxCPM2",
        status: ttsStatus,
        icon: Volume2,
        unload: manualUnloadTTS,
      },
      {
        key: "music",
        label: "音乐模型",
        detail: systemStatus?.music_backend || systemStatus?.config?.music_model_variant || "ACE-Step",
        status: musicStatus,
        icon: Music,
        unload: manualUnloadMusic,
      },
    ];
  }, [manualUnloadASR, manualUnloadLLM, manualUnloadMusic, manualUnloadTTS, systemStatus]);

  async function confirmAndRun(label, key, handler) {
    const confirmed = await useUiStore.getState().requestConfirm({
      title: key === "all" ? "卸载全部模型" : `卸载 ${label}`,
      description: key === "all" ? "正在运行的模型都会释放，后续任务会重新加载。" : "相关任务可能需要重新加载模型。",
      confirmLabel: "卸载",
      danger: true,
    });
    if (!confirmed) return;
    setBusyKey(key);
    try {
      await handler?.();
    } finally {
      setBusyKey("");
    }
  }

  const gpu = systemStatus?.gpu || {};
  const usedVram = Number(gpu.system_used_vram_mb ?? gpu.used_vram_mb ?? 0);
  const totalVram = Number(gpu.total_vram_mb ?? 0);
  const freeVram = Number(gpu.system_free_vram_mb ?? gpu.free_vram_mb ?? 0);
  const vramLabel = totalVram > 0
    ? `${(usedVram / 1024).toFixed(1)} / ${(totalVram / 1024).toFixed(1)} GB`
    : "未检测";

  return (
    <aside className={`modelStatusPanel ${collapsed ? "collapsed" : ""}`} aria-label="系统与模型状态">
      {collapsed ? (
        <button
          type="button"
          className="modelPanelCollapsedButton"
          onClick={() => setCollapsed(false)}
          aria-label="展开系统状态"
          title="展开系统状态"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>系统状态</span>
        </button>
      ) : null}
      <div className="modelPanelSection">
        <div className="modelPanelHeader">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>系统与模型状态</h2>
          </div>
          <div className="modelPanelHeaderActions">
            <button
              type="button"
              className="workspaceIconButton"
              onClick={() => setCollapsed(true)}
              aria-label="收起系统与模型状态"
              title="收起"
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              disabled={busyKey === "refresh"}
              onClick={async () => {
                setBusyKey("refresh");
                try {
                  await refreshSystemStatus();
                } finally {
                  setBusyKey("");
                }
              }}
            >
              刷新
            </Button>
          </div>
        </div>

        <div className="modelList">
          {models.map((model) => {
            const Icon = model.icon;
            const tone = statusTone(model.status);
            const isBusy = busyKey === model.key;
            const canUnload = model.status === "ready" || model.status === "error";
            return (
              <div key={model.key} className={`modelStatusRow ${tone}`}>
                <span className="modelStatusIcon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="modelStatusCopy">
                  <strong>{model.label}</strong>
                  <small>{model.detail}</small>
                </span>
                <span className="modelState">
                  <span className={`statusBarDot ${tone === "ready" ? "ready" : tone === "error" ? "error" : tone === "loading" ? "loading" : "idle"}`} />
                  {STATUS_LABELS[model.status] || model.status}
                </span>
                <button
                  type="button"
                  className="modelUnloadButton"
                  disabled={!canUnload || Boolean(busyKey)}
                  onClick={() => confirmAndRun(model.label, model.key, model.unload)}
                  aria-label={`卸载 ${model.label}`}
                  title={`卸载 ${model.label}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
                {isBusy ? <span className="modelBusyText">卸载中</span> : null}
              </div>
            );
          })}
        </div>

        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          className="modelUnloadAllButton"
          disabled={Boolean(busyKey)}
          onClick={() => confirmAndRun("全部模型", "all", manualUnloadAll)}
        >
          全部卸载
        </Button>
      </div>

      <div className="modelPanelSection">
        <div className="modelPanelHeader compact">
          <h2>本地资源</h2>
          <span className="panelFinePrint">{systemStatus?.state || "local"}</span>
        </div>
        <div className="resourceRows">
          <div className="resourceRow">
            <HardDrive size={17} aria-hidden="true" />
            <span>VRAM</span>
            <strong>{vramLabel}</strong>
          </div>
          <div className="resourceRow">
            <Database size={17} aria-hidden="true" />
            <span>空闲显存</span>
            <strong>{freeVram ? `${(freeVram / 1024).toFixed(1)} GB` : "未知"}</strong>
          </div>
        </div>
      </div>
    </aside>
  );
}
