import { CheckCircle2, ChevronDown, FolderOpen, Menu, Save, Settings, Star } from "lucide-react";

import Button from "../ui/Button";
import { useProjectStore } from "../../stores/useProjectStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUiStore } from "../../stores/useUiStore";
import { toProjectFileDisplayName } from "../../utils/projectToolbar";

const PAGE_TITLES = {
  speech: "语音识别",
  text: "文本输入",
  qc: "解析质检",
  script: "剧本编辑",
  voice: "声音配置",
  music: "音乐生成",
  synth: "合成导出",
  settings: "系统设置",
};

function getReadyCount(systemStatus) {
  const checks = [
    systemStatus?.llm_status ?? (systemStatus?.llm_loaded ? "ready" : "idle"),
    systemStatus?.asr_loaded ? "ready" : "idle",
    systemStatus?.tts_status ?? (systemStatus?.tts_loaded ? "ready" : "idle"),
    systemStatus?.music_status ?? (systemStatus?.music_loaded ? "ready" : "idle"),
  ];
  return checks.filter((item) => item === "ready").length;
}

export default function WorkspaceHeader({ activePage, onNavigate }) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentProjectFileName = useProjectStore((state) => state.currentProjectFileName);
  const systemStatus = useSettingsStore((state) => state.systemStatus);
  const projectSaveAction = useUiStore((state) => state.projectSaveAction);
  const canSaveProject = typeof projectSaveAction === "function";
  const projectName = currentProject?.name || "Demo Audiobook";
  const pageTitle = PAGE_TITLES[activePage] || "制作流程";
  const fileName = toProjectFileDisplayName(currentProjectFileName || currentProject?.project_file_name);
  const readyCount = getReadyCount(systemStatus);
  const allReady = readyCount >= 3;

  return (
    <header className="workspaceHeader">
      <div className="workspaceHeaderIdentity">
        <div className="workspaceTitleRow">
          <h1>{projectName}</h1>
          <button type="button" className="workspaceIconButton" aria-label="切换项目">
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="workspaceIconButton" aria-label="收藏项目">
            <Star size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="workspaceMetaRow">
          <span className="workspaceMetaStatus">
            <CheckCircle2 size={14} aria-hidden="true" />
            {canSaveProject ? "可保存" : "只读状态"}
          </span>
          <span>{pageTitle}</span>
          <span>{fileName ? `项目文件：${fileName}` : "本地项目"}</span>
        </div>
      </div>

      <div className="workspaceHeaderActions">
        <span className={`workspaceModelReady ${allReady ? "ready" : ""}`}>
          <span className="statusBarDot ready" />
          {allReady ? "本地模型运行正常" : `模型就绪 ${readyCount}/4`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={Save}
          disabled={!canSaveProject}
          onClick={() => projectSaveAction?.()}
        >
          保存
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={FolderOpen}
          disabled={!canSaveProject}
          onClick={() => projectSaveAction?.({ forceSaveAs: true })}
        >
          另存
        </Button>
        <button
          type="button"
          className="workspaceIconButton"
          onClick={() => onNavigate?.("settings")}
          aria-label="打开系统设置"
        >
          <Settings size={17} aria-hidden="true" />
        </button>
        <button type="button" className="workspaceIconButton" aria-label="更多操作">
          <Menu size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
