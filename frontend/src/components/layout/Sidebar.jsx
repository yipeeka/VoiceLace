import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Mic,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useUiStore } from "../../stores/useUiStore";

const NAV_ITEMS = [
  { id: "text",    label: "文本输入",  icon: BookOpen,          step: 1 },
  { id: "script",  label: "剧本编辑",  icon: SlidersHorizontal, step: 2 },
  { id: "voice",   label: "声音配置",  icon: Mic,               step: 3 },
  { id: "synth",   label: "合成导出",  icon: Volume2,           step: 4 },
];

export default function Sidebar({ activePage, onNavigate, collapsed, onToggleCollapse, completedPages = [] }) {
  const projectSaveAction = useUiStore((state) => state.projectSaveAction);
  const canShowProjectSave = ["text", "script", "voice"].includes(activePage);
  const canSaveProject = typeof projectSaveAction === "function";

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Brand */}
      <div className="sidebarBrand">
        <div className="sidebarLogo">
          <Sparkles size={16} color="white" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              className="sidebarBrandText"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="title">BeautyVoice</div>
              <div className="subtitle">AI 有声书工作台</div>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          className="sidebarCollapseBtn"
          onClick={onToggleCollapse}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebarNav">
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          const isCompleted = completedPages.includes(item.id);
          const Icon = item.icon;

          const button = (
            <button
              key={item.id}
              className={`navItem ${isActive ? "active" : ""} ${isCompleted && !isActive ? "completed" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="navItemIcon" size={18} />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    className="navItemLabel"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    className="navItemStep"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    {isCompleted && !isActive ? "✓" : item.step}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );

          const renderedButton = collapsed ? (
            <Tooltip key={item.id} content={item.label} side="right">
              {button}
            </Tooltip>
          ) : (
            button
          );

          if (item.id !== "synth") {
            return renderedButton;
          }

          return (
            <div key={item.id} className="sidebarNavGroup">
              {renderedButton}
              {canShowProjectSave ? (
                collapsed ? (
                  <Tooltip content={canSaveProject ? "保存项目" : "当前页面不可保存"} side="right">
                    <button
                      className="navItem navItemSubAction"
                      onClick={() => projectSaveAction?.()}
                      disabled={!canSaveProject}
                      title="保存项目"
                    >
                      <Save className="navItemIcon" size={18} />
                    </button>
                  </Tooltip>
                ) : (
                  <button
                    className="navItem navItemSubAction"
                    onClick={() => projectSaveAction?.()}
                    disabled={!canSaveProject}
                  >
                    <Save className="navItemIcon" size={16} />
                    <span className="navItemLabel">保存项目</span>
                  </button>
                )
              ) : null}
            </div>
          );
        })}

        <div className="sidebarDivider" />

        {/* Settings */}
        {collapsed ? (
          <Tooltip content="设置" side="right">
            <button
              className={`navItem ${activePage === "settings" ? "active" : ""}`}
              onClick={() => onNavigate("settings")}
            >
              <Settings className="navItemIcon" size={18} />
            </button>
          </Tooltip>
        ) : (
          <button
            className={`navItem ${activePage === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <Settings className="navItemIcon" size={18} />
            <span className="navItemLabel">系统设置</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
