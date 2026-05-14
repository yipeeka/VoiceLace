import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Languages,
  ShieldCheck,
  Mic,
  Music,
  Power,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  Volume2,
} from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUiStore } from "../../stores/useUiStore";
import { useI18n } from "../../i18n/I18nProvider";

const NAV_ITEMS = [
  { id: "speech",  labelKey: "sidebar.nav.speech", icon: Mic, step: 1 },
  { id: "text",    labelKey: "sidebar.nav.text", icon: BookOpen, step: 2 },
  { id: "qc",      labelKey: "sidebar.nav.qc", icon: ShieldCheck, step: 3 },
  { id: "script",  labelKey: "sidebar.nav.script", icon: SlidersHorizontal, step: 4 },
  { id: "voice",   labelKey: "sidebar.nav.voice", icon: Users, step: 5 },
  { id: "music",   labelKey: "sidebar.nav.music", icon: Music, step: 6 },
  { id: "synth",   labelKey: "sidebar.nav.synth", icon: Volume2, step: 7 },
];

export default function Sidebar({ activePage, onNavigate, collapsed, onToggleCollapse, completedPages = [] }) {
  const projectSaveAction = useUiStore((state) => state.projectSaveAction);
  const manualUnloadAll = useSettingsStore((state) => state.manualUnloadAll);
  const { language, setLanguage, t } = useI18n();
  const canShowProjectSave = ["speech", "text", "script", "voice", "music", "synth"].includes(activePage);
  const canSaveProject = typeof projectSaveAction === "function";
  const toggleLanguage = () => setLanguage(language === "zh" ? "en" : "zh");

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
              <div className="title">VoiceLace</div>
              <div className="subtitle">{t("sidebar.brand.subtitle")}</div>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          className="sidebarCollapseBtn"
          onClick={onToggleCollapse}
          title={collapsed ? t("sidebar.collapse.expand") : t("sidebar.collapse.collapse")}
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
                    {t(item.labelKey)}
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
            <Tooltip key={item.id} content={t(item.labelKey)} side="right">
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
                <>
                  {collapsed ? (
                    <>
                      <Tooltip content={canSaveProject ? t("sidebar.project.save") : t("sidebar.project.saveUnavailable")} side="right">
                        <button
                          className="navItem navItemSubAction"
                          onClick={() => projectSaveAction?.()}
                          disabled={!canSaveProject}
                          title={t("sidebar.project.save")}
                        >
                          <Save className="navItemIcon" size={18} />
                        </button>
                      </Tooltip>
                      <Tooltip content={canSaveProject ? t("sidebar.project.saveAs") : t("sidebar.project.saveUnavailable")} side="right">
                        <button
                          className="navItem navItemSubAction"
                          onClick={() => projectSaveAction?.({ forceSaveAs: true })}
                          disabled={!canSaveProject}
                          title={t("sidebar.project.saveAs")}
                        >
                          <FolderOpen className="navItemIcon" size={18} />
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <button
                        className="navItem navItemSubAction"
                        onClick={() => projectSaveAction?.()}
                        disabled={!canSaveProject}
                      >
                        <Save className="navItemIcon" size={16} />
                        <span className="navItemLabel">{t("sidebar.project.save")}</span>
                      </button>
                      <button
                        className="navItem navItemSubAction"
                        onClick={() => projectSaveAction?.({ forceSaveAs: true })}
                        disabled={!canSaveProject}
                      >
                        <FolderOpen className="navItemIcon" size={16} />
                        <span className="navItemLabel">{t("sidebar.project.saveAs")}</span>
                      </button>
                    </>
                  )}
                </>
              ) : null}
            </div>
          );
        })}

        <div className="sidebarDivider" />

        {collapsed ? (
          <Tooltip content={t("sidebar.unloadAll")} side="right">
            <button
              className="navItem navItemSubAction navItemDangerAction"
              onClick={() => manualUnloadAll?.()}
              title={t("sidebar.unloadAll")}
            >
              <Power className="navItemIcon" size={18} />
            </button>
          </Tooltip>
        ) : (
          <button
            className="navItem navItemSubAction navItemDangerAction"
            onClick={() => manualUnloadAll?.()}
          >
            <Power className="navItemIcon" size={16} />
            <span className="navItemLabel">{t("sidebar.unloadAll")}</span>
          </button>
        )}

        {collapsed ? (
          <Tooltip content={language === "zh" ? t("sidebar.langToggle.en") : t("sidebar.langToggle.zh")} side="right">
            <button className="navItem navItemSubAction" onClick={toggleLanguage} title={language === "zh" ? t("sidebar.langToggle.en") : t("sidebar.langToggle.zh")}>
              <Languages className="navItemIcon" size={18} />
            </button>
          </Tooltip>
        ) : (
          <button className="navItem navItemSubAction" onClick={toggleLanguage} title={language === "zh" ? t("sidebar.langToggle.en") : t("sidebar.langToggle.zh")}>
            <Languages className="navItemIcon" size={16} />
            <span className="navItemLabel">{language === "zh" ? t("settings.languageSwitch.compactZh") : t("settings.languageSwitch.compactEn")}</span>
          </button>
        )}

        {/* Settings */}
        {collapsed ? (
          <Tooltip content={t("sidebar.settings")} side="right">
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
            <span className="navItemLabel">{t("sidebar.settings")}</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
