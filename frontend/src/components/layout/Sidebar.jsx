import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Mic,
  Music,
  Settings,
  SlidersHorizontal,
  Users,
  Volume2,
} from "lucide-react";
import { Tooltip } from "../ui/Tooltip";

const NAV_ITEMS = [
  { id: "speech",  label: "语音识别",  icon: Mic,               step: 1 },
  { id: "text",    label: "文本输入",  icon: BookOpen,          step: 2 },
  { id: "qc",      label: "解析质检",  icon: ShieldCheck,       step: 3 },
  { id: "script",  label: "剧本编辑",  icon: SlidersHorizontal, step: 4 },
  { id: "voice",   label: "声音配置",  icon: Users,             step: 5 },
  { id: "music",   label: "音乐生成",  icon: Music,             step: 6 },
  { id: "synth",   label: "合成导出",  icon: Volume2,           step: 7 },
];

export default function Sidebar({ activePage, onNavigate, collapsed, onToggleCollapse, completedPages = [] }) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Brand */}
      <div className="sidebarBrand">
        <div className="sidebarLogo" aria-hidden="true">
          <img src="/favicon.svg" alt="" />
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
              <div className="title">VoiceLace</div>
              <div className="subtitle">AI 有声书工作台</div>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          className="sidebarCollapseBtn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          {collapsed ? <ChevronRight aria-hidden="true" focusable="false" size={13} /> : <ChevronLeft aria-hidden="true" focusable="false" size={13} />}
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
              type="button"
              key={item.id}
              className={`navItem ${isActive ? "active" : ""} ${isCompleted && !isActive ? "completed" : ""}`}
              onClick={() => onNavigate(item.id)}
              aria-label={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="navItemIcon" aria-hidden="true" focusable="false" size={18} />
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

          return renderedButton;
        })}

        <div className="sidebarDivider" />

        {/* Settings */}
        {collapsed ? (
          <Tooltip content="设置" side="right">
            <button
              type="button"
              className={`navItem ${activePage === "settings" ? "active" : ""}`}
              onClick={() => onNavigate("settings")}
              aria-label="系统设置"
              aria-current={activePage === "settings" ? "page" : undefined}
            >
              <Settings className="navItemIcon" aria-hidden="true" focusable="false" size={18} />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            className={`navItem ${activePage === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
            aria-current={activePage === "settings" ? "page" : undefined}
          >
            <Settings className="navItemIcon" aria-hidden="true" focusable="false" size={18} />
            <span className="navItemLabel">系统设置</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
