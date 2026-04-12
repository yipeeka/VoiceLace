import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import Sidebar from "./components/layout/Sidebar";
import StatusBar from "./components/layout/StatusBar";
import ToastLayer from "./components/shared/ToastLayer";
import { TooltipProvider } from "./components/ui/Tooltip";
import ScriptEditorPage from "./pages/ScriptEditorPage";
import SettingsPage from "./pages/SettingsPage";
import SynthesisPage from "./pages/SynthesisPage";
import TextInputPage from "./pages/TextInputPage";
import VoiceConfigPage from "./pages/VoiceConfigPage";
import { useProjectStore } from "./stores/useProjectStore";
import { useScriptStore } from "./stores/useScriptStore";

const PAGE_COMPONENTS = {
  text:     TextInputPage,
  script:   ScriptEditorPage,
  voice:    VoiceConfigPage,
  synth:    SynthesisPage,
  settings: SettingsPage,
};

const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: "easeOut" },
};

export default function App() {
  const [activePage, setActivePage] = useState("text");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { currentProject, projects, loadProjects } = useProjectStore();
  const { script } = useScriptStore();

  useEffect(() => {
    loadProjects().catch(() => undefined);

    // Keyboard shortcuts
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "1") { e.preventDefault(); setActivePage("text"); }
        if (e.key === "2") { e.preventDefault(); setActivePage("script"); }
        if (e.key === "3") { e.preventDefault(); setActivePage("voice"); }
        if (e.key === "4") { e.preventDefault(); setActivePage("synth"); }
        if (e.key === "b") { e.preventDefault(); setSidebarCollapsed((c) => !c); }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadProjects]);

  // Derive which pages are "completed" for step indicators
  const completedPages = [];
  if (currentProject?.id) completedPages.push("text");
  if (script?.segments?.length > 0) completedPages.push("script");
  if (currentProject?.voice_assignments && Object.keys(currentProject.voice_assignments).length > 0) {
    completedPages.push("voice");
  }

  const PageComponent = PAGE_COMPONENTS[activePage] ?? PAGE_COMPONENTS.text;

  return (
    <TooltipProvider>
      <div className="appShell">
        <Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          completedPages={completedPages}
        />

        <div className="mainArea">
          <div className="pageContent">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                {...PAGE_TRANSITION}
                style={{ flex: 1 }}
              >
                <PageComponent onNavigate={setActivePage} />
              </motion.div>
            </AnimatePresence>
          </div>

          <StatusBar />
        </div>
      </div>

      <ToastLayer />
    </TooltipProvider>
  );
}
