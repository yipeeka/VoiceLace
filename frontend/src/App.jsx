import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import Sidebar from "./components/layout/Sidebar";
import StatusBar from "./components/layout/StatusBar";
import ToastLayer from "./components/shared/ToastLayer";
import { TooltipProvider } from "./components/ui/Tooltip";
import ScriptEditorPage from "./pages/ScriptEditorPage";
import SettingsPage from "./pages/SettingsPage";
import SpeechRecognitionPage from "./pages/SpeechRecognitionPage";
import SynthesisPage from "./pages/SynthesisPage";
import ParseQcPage from "./pages/ParseQcPage";
import TextInputPage from "./pages/TextInputPage";
import VoiceConfigPage from "./pages/VoiceConfigPage";
import { useProjectStore } from "./stores/useProjectStore";
import { useScriptStore } from "./stores/useScriptStore";

const PAGE_COMPONENTS = {
  speech:   SpeechRecognitionPage,
  text:     TextInputPage,
  qc:       ParseQcPage,
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
  const [activePage, setActivePage] = useState("speech");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { currentProject, projects, loadProjects, selectProject } = useProjectStore();
  const { script, sourceText } = useScriptStore();

  useEffect(() => {
    let disposed = false;
    (async () => {
      const loaded = await loadProjects().catch(() => null);
      if (disposed || !Array.isArray(loaded) || loaded.length === 0) {
        return;
      }
      const lastOpenedProjectId = useProjectStore.getState().lastOpenedProjectId;
      const hasLastOpened = Boolean(lastOpenedProjectId) && loaded.some((item) => item.id === lastOpenedProjectId);
      const targetId = hasLastOpened
        ? lastOpenedProjectId
        : [...loaded].sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""))[0]?.id;
      if (!targetId) return;
      if (useProjectStore.getState().currentProject?.id === targetId) return;
      await selectProject(targetId, { suppressToast: true }).catch(() => undefined);
      await useScriptStore.getState().loadProjectScript(targetId).catch(() => undefined);
    })();

    // Keyboard shortcuts
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "1") { e.preventDefault(); setActivePage("speech"); }
        if (e.key === "2") { e.preventDefault(); setActivePage("text"); }
        if (e.key === "3") { e.preventDefault(); setActivePage("qc"); }
        if (e.key === "4") { e.preventDefault(); setActivePage("script"); }
        if (e.key === "5") { e.preventDefault(); setActivePage("voice"); }
        if (e.key === "6") { e.preventDefault(); setActivePage("synth"); }
        if (e.key === "b") { e.preventDefault(); setSidebarCollapsed((c) => !c); }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadProjects, selectProject]);

  // Derive which pages are "completed" for step indicators
  const completedPages = [];
  if (sourceText?.trim()) completedPages.push("speech");
  if (currentProject?.id) completedPages.push("text");
  if (script?.segments?.length > 0) completedPages.push("qc");
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
