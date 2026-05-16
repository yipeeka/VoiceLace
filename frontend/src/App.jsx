import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

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
import MusicPage from "./pages/MusicPage";
import { useProjectStore } from "./stores/useProjectStore";
import { useScriptStore } from "./stores/useScriptStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import {
  isAutoSerialEnabled,
  sendPageUnloadBeacon,
  unloadModelForPage,
} from "./utils/modelLifecycle.js";

const PAGE_COMPONENTS = {
  speech:   SpeechRecognitionPage,
  text:     TextInputPage,
  qc:       ParseQcPage,
  script:   ScriptEditorPage,
  voice:    VoiceConfigPage,
  synth:    SynthesisPage,
  music:    MusicPage,
  settings: SettingsPage,
};

const DEFAULT_PAGE = "speech";
const PAGE_IDS = new Set(Object.keys(PAGE_COMPONENTS));
const PAGE_KEY_MAP = {
  "1": "speech",
  "2": "text",
  "3": "qc",
  "4": "script",
  "5": "voice",
  "6": "music",
  "7": "synth",
};

const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: "easeOut" },
};

const REDUCED_PAGE_TRANSITION = {
  initial: { opacity: 1, y: 0 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 1, y: 0 },
  transition: { duration: 0 },
};

function readPageFromLocation() {
  if (typeof window === "undefined") {
    return DEFAULT_PAGE;
  }
  const page = new URLSearchParams(window.location.search).get("page");
  return PAGE_IDS.has(page) ? page : DEFAULT_PAGE;
}

function writePageToLocation(page, { replace = false } = {}) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("page") === page) {
    return;
  }
  url.searchParams.set("page", page);
  window.history[replace ? "replaceState" : "pushState"]({ page }, "", url);
}

export default function App() {
  const [activePage, setActivePage] = useState(readPageFromLocation);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activePageRef = useRef(activePage);
  const navigationTokenRef = useRef(0);
  const prefersReducedMotion = useReducedMotion();
  const { currentProject, projects, loadProjects, selectProject } = useProjectStore();
  const { script, sourceText } = useScriptStore();

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  const navigateToPage = useCallback((page, options) => {
    const targetPage = PAGE_IDS.has(page) ? page : DEFAULT_PAGE;
    const sourcePage = activePageRef.current;
    if (targetPage === sourcePage) {
      writePageToLocation(targetPage, options);
      return;
    }

    const token = ++navigationTokenRef.current;
    (async () => {
      const settings = useSettingsStore.getState();
      let autoSerial = isAutoSerialEnabled(settings.systemStatus, settings.orchestratorConfig);
      if (autoSerial === null) {
        const loadedConfig = await settings.loadOrchestratorConfig().catch(() => null);
        autoSerial = Boolean(loadedConfig?.auto_serial);
      }

      if (autoSerial) {
        await unloadModelForPage(sourcePage).catch(() => undefined);
        await useSettingsStore.getState().refreshSystemStatus().catch(() => undefined);
      }

      if (token !== navigationTokenRef.current) {
        return;
      }
      activePageRef.current = targetPage;
      setActivePage(targetPage);
      writePageToLocation(targetPage, options);
    })();
  }, []);

  useEffect(() => {
    writePageToLocation(activePage, { replace: true });
  }, [activePage]);

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

    return () => {
      disposed = true;
    };
  }, [loadProjects, selectProject]);

  useEffect(() => {
    function handlePopState() {
      navigateToPage(readPageFromLocation(), { replace: true });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigateToPage]);

  useEffect(() => {
    function handlePageHide() {
      const settings = useSettingsStore.getState();
      if (isAutoSerialEnabled(settings.systemStatus, settings.orchestratorConfig)) {
        sendPageUnloadBeacon(activePageRef.current);
      }
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey) {
        const shortcutPage = PAGE_KEY_MAP[e.key];
        if (shortcutPage) {
          e.preventDefault();
          navigateToPage(shortcutPage);
        }
        if (e.key === "b") { e.preventDefault(); setSidebarCollapsed((c) => !c); }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateToPage]);

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
      <a className="skipLink" href="#main-content">跳到主内容</a>
      <div className="appShell">
        <Sidebar
          activePage={activePage}
          onNavigate={navigateToPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          completedPages={completedPages}
        />

        <main id="main-content" className="mainArea" tabIndex={-1}>
          <div className="pageContent">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                {...(prefersReducedMotion ? REDUCED_PAGE_TRANSITION : PAGE_TRANSITION)}
                style={{ flex: 1 }}
              >
                <PageComponent onNavigate={navigateToPage} />
              </motion.div>
            </AnimatePresence>
          </div>

          <StatusBar />
        </main>
      </div>

      <ToastLayer />
    </TooltipProvider>
  );
}
