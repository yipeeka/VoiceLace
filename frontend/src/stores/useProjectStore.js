import { create } from "zustand";

import { api } from "../utils/api.js";
import { formatError } from "../utils/errors.js";
import { useUiStore } from "./useUiStore.js";

const LAST_OPENED_PROJECT_ID_KEY = "beautyvoicetts:lastOpenedProjectId";
const PROJECT_SOURCES_KEY = "beautyvoicetts:projectSources";

function safeReadLastOpenedProjectId() {
  try {
    return window.localStorage.getItem(LAST_OPENED_PROJECT_ID_KEY) || "";
  } catch {
    return "";
  }
}

function safeWriteLastOpenedProjectId(projectId) {
  try {
    if (!projectId) {
      window.localStorage.removeItem(LAST_OPENED_PROJECT_ID_KEY);
      return;
    }
    window.localStorage.setItem(LAST_OPENED_PROJECT_ID_KEY, projectId);
  } catch {
    // Ignore localStorage failures.
  }
}

function safeReadProjectSources() {
  try {
    const raw = window.localStorage.getItem(PROJECT_SOURCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function safeWriteProjectSources(projectSources) {
  try {
    const payload = projectSources && typeof projectSources === "object" ? projectSources : {};
    window.localStorage.setItem(PROJECT_SOURCES_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage failures.
  }
}

function toProjectSummary(project) {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    updated_at: project.updated_at,
    origin_kind: project?.project_origin?.kind || "local",
    source_project_id: project?.project_origin?.source_project_id || null,
    project_file_name: project?.project_origin?.project_file_name || null,
  };
}

function toTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function upsertProjectSummary(projects, summary) {
  if (!summary?.id) return projects || [];
  return [summary, ...(projects || []).filter((item) => item.id !== summary.id)];
}

function sortProjectSummaries(projects, lastOpenedProjectId) {
  const list = Array.isArray(projects) ? [...projects] : [];
  list.sort((a, b) => {
    if (a.id === lastOpenedProjectId && b.id !== lastOpenedProjectId) return -1;
    if (b.id === lastOpenedProjectId && a.id !== lastOpenedProjectId) return 1;
    return toTimestamp(b.updated_at) - toTimestamp(a.updated_at);
  });
  return list;
}

function deriveProjectSourceFromProject(project) {
  const kind = project?.project_origin?.kind;
  return typeof kind === "string" && kind ? kind : null;
}

function deriveProjectSourceFromSummary(summary) {
  const kind = summary?.origin_kind;
  return typeof kind === "string" && kind ? kind : null;
}

function mergeProjectSourcesFromSummaries(existingSources, summaries) {
  const next = { ...(existingSources || {}) };
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    if (!summary?.id) continue;
    const source = deriveProjectSourceFromSummary(summary);
    if (source) {
      next[summary.id] = source;
    } else if (!next[summary.id]) {
      next[summary.id] = "local";
    }
  }
  return next;
}

function getBindingForProject(state, projectId) {
  if (!projectId) return null;
  return state.projectFileBindings?.[projectId] || null;
}

function getCurrentBindingState(state, currentProject) {
  const binding = getBindingForProject(state, currentProject?.id);
  const originFileName =
    currentProject?.project_origin?.kind === "project_file"
      ? currentProject?.project_origin?.project_file_name || ""
      : "";
  return {
    currentProjectFileHandle: binding?.handle || null,
    currentProjectFileName: binding?.fileName || originFileName,
  };
}

export const useProjectStore = create((set, get) => ({
  currentProject: null,
  projects: [],
  projectEvents: [],
  importWarnings: [],
  lastOpenedProjectId: safeReadLastOpenedProjectId(),
  projectSources: safeReadProjectSources(),
  projectFileBindings: {},
  currentProjectFileHandle: null,
  currentProjectFileName: "",
  isLoading: false,
  setCurrentProject: (project) =>
    set((state) => {
      const bindingState = getCurrentBindingState(state, project);
      return {
        currentProject: project,
        ...bindingState,
      };
    }),
  clearImportWarnings: () => set({ importWarnings: [] }),
  bindCurrentProjectFile: (payload) =>
    set((state) => {
      const projectId = state.currentProject?.id;
      if (!projectId) {
        return {};
      }
      const nextBindings = {
        ...(state.projectFileBindings || {}),
        [projectId]: {
          handle: payload?.handle || null,
          fileName: payload?.fileName || "",
        },
      };
      return {
        projectFileBindings: nextBindings,
        projectSources: (() => {
          const nextSources = {
            ...(state.projectSources || {}),
            [projectId]: "project_file",
          };
          safeWriteProjectSources(nextSources);
          return nextSources;
        })(),
        currentProjectFileHandle: nextBindings[projectId].handle,
        currentProjectFileName: nextBindings[projectId].fileName,
      };
    }),
  clearCurrentProjectFileBinding: () =>
    set((state) => {
      const projectId = state.currentProject?.id;
      if (!projectId) return {};
      const nextBindings = { ...(state.projectFileBindings || {}) };
      delete nextBindings[projectId];
      return {
        projectFileBindings: nextBindings,
        currentProjectFileHandle: null,
        currentProjectFileName: "",
      };
    }),
  setProjects: (projects) =>
    set((state) => {
      const nextSources = mergeProjectSourcesFromSummaries(state.projectSources, projects);
      safeWriteProjectSources(nextSources);
      return {
        projects: sortProjectSummaries(projects, state.lastOpenedProjectId),
        projectSources: nextSources,
      };
    }),
  loadProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await api.get("/projects");
      set((state) => ({
        projects: sortProjectSummaries(projects, state.lastOpenedProjectId),
        projectSources: (() => {
          const nextSources = mergeProjectSourcesFromSummaries(state.projectSources, projects);
          safeWriteProjectSources(nextSources);
          return nextSources;
        })(),
        isLoading: false,
      }));
      return projects;
    } catch (error) {
      set({ isLoading: false });
      useUiStore.getState().pushToast({ title: formatError("项目列表加载失败", error), tone: "error" });
      throw error;
    }
  },
  createProject: async (name) => {
    const project = await api.post("/projects", { name });
    safeWriteLastOpenedProjectId(project.id);
    set((state) => {
      const summary = toProjectSummary(project);
      const projects = sortProjectSummaries(upsertProjectSummary(state.projects, summary), project.id);
      const source = deriveProjectSourceFromProject(project) || "local";
      const nextSources = { ...(state.projectSources || {}), [project.id]: source };
      safeWriteProjectSources(nextSources);
      const nextBindings = { ...(state.projectFileBindings || {}) };
      delete nextBindings[project.id];
      return {
        currentProject: project,
        importWarnings: [],
        projects,
        lastOpenedProjectId: project.id,
        projectSources: nextSources,
        projectFileBindings: nextBindings,
        currentProjectFileHandle: null,
        currentProjectFileName: "",
      };
    });
    useUiStore.getState().pushToast({ title: `已创建项目：${project.name}`, tone: "success" });
    return project;
  },
  selectProject: async (projectId, options = {}) => {
    const project = await api.get(`/projects/${projectId}`);
    safeWriteLastOpenedProjectId(project.id);
    set((state) => {
      const summary = toProjectSummary(project);
      const projects = sortProjectSummaries(upsertProjectSummary(state.projects, summary), project.id);
      const source = deriveProjectSourceFromProject(project) || state.projectSources?.[project.id] || "local";
      const nextSources = {
        ...(state.projectSources || {}),
        [project.id]: source,
      };
      safeWriteProjectSources(nextSources);
      const bindingState = getCurrentBindingState(state, project);
      return {
        currentProject: project,
        importWarnings: [],
        projects,
        lastOpenedProjectId: project.id,
        projectSources: nextSources,
        ...bindingState,
      };
    });
    if (!options?.suppressToast) {
      useUiStore.getState().pushToast({ title: `已切换到项目：${project.name}`, tone: "default" });
    }
    return project;
  },
  refreshCurrentProject: async (projectId) => {
    const project = await api.get(`/projects/${projectId}`);
    set((state) => {
      const summary = toProjectSummary(project);
      const projects = sortProjectSummaries(upsertProjectSummary(state.projects, summary), state.lastOpenedProjectId);
      const source = deriveProjectSourceFromProject(project);
      const nextSources = source
        ? { ...(state.projectSources || {}), [project.id]: source }
        : state.projectSources;
      if (source) {
        safeWriteProjectSources(nextSources);
      }
      const isCurrent = state.currentProject?.id === project.id;
      const bindingState = isCurrent ? getCurrentBindingState(state, project) : {};
      return {
        currentProject: isCurrent ? project : state.currentProject,
        projects,
        projectSources: nextSources,
        ...bindingState,
      };
    });
    return project;
  },
  loadProjectEvents: async (projectId, limit = 500) => {
    const events = await api.get(`/projects/${projectId}/events?limit=${limit}`);
    set({ projectEvents: events });
    return events;
  },
  deleteProject: async (projectId) => {
    await api.delete(`/projects/${projectId}`);
    set((state) => {
      const projects = (state.projects || []).filter((item) => item.id !== projectId);
      const nextSources = { ...(state.projectSources || {}) };
      delete nextSources[projectId];
      safeWriteProjectSources(nextSources);
      const nextBindings = { ...(state.projectFileBindings || {}) };
      delete nextBindings[projectId];

      const currentProject = state.currentProject?.id === projectId ? null : state.currentProject;
      let nextLastOpened = state.lastOpenedProjectId;
      if (nextLastOpened === projectId) {
        nextLastOpened = currentProject?.id || (projects[0]?.id ?? "");
        safeWriteLastOpenedProjectId(nextLastOpened);
      }
      const bindingState = getCurrentBindingState({ ...state, projectFileBindings: nextBindings }, currentProject);

      return {
        projects,
        currentProject,
        projectSources: nextSources,
        projectFileBindings: nextBindings,
        lastOpenedProjectId: nextLastOpened,
        importWarnings: currentProject ? state.importWarnings : [],
        projectEvents: currentProject ? state.projectEvents : [],
        ...bindingState,
      };
    });
    useUiStore.getState().pushToast({ title: "项目已删除", tone: "success" });
  },
  importArchive: async (file) => {
    const result = await api.uploadFile("/projects/import/archive", file);
    const project = await api.get(`/projects/${result.project_id}`);
    safeWriteLastOpenedProjectId(project.id);
    set((state) => {
      const summary = toProjectSummary(project);
      const projects = sortProjectSummaries(upsertProjectSummary(state.projects, summary), project.id);
      const nextSources = {
        ...(state.projectSources || {}),
        [project.id]: deriveProjectSourceFromProject(project) || result?.import_source || "archive_import",
      };
      safeWriteProjectSources(nextSources);
      const nextBindings = { ...(state.projectFileBindings || {}) };
      delete nextBindings[project.id];
      return {
        currentProject: project,
        importWarnings: Array.isArray(result.warnings) ? result.warnings : [],
        projects,
        lastOpenedProjectId: project.id,
        projectSources: nextSources,
        projectFileBindings: nextBindings,
        currentProjectFileHandle: null,
        currentProjectFileName: "",
      };
    });
    useUiStore.getState().pushToast({ title: `工程导入完成：${project.name}`, tone: "success" });
    if (Array.isArray(result.warnings) && result.warnings.length) {
      result.warnings.forEach((warning, index) => {
        useUiStore.getState().pushToast({
          title: `导入提示 ${index + 1}/${result.warnings.length}：${warning}`,
          tone: "warning",
        });
      });
    }
    return { ...result, project };
  },
  importProjectFile: async (file, options = {}) => {
    const result = await api.uploadFile("/projects/import/project-file", file);
    const project = await api.get(`/projects/${result.project_id}`);
    const binding = {
      handle: options.handle || null,
      fileName: options.fileName || file?.name || "",
    };
    safeWriteLastOpenedProjectId(project.id);
    set((state) => {
      const summary = toProjectSummary(project);
      const projects = sortProjectSummaries(upsertProjectSummary(state.projects, summary), project.id);
      const nextBindings = {
        ...(state.projectFileBindings || {}),
        [project.id]: binding,
      };
      const nextSources = {
        ...(state.projectSources || {}),
        [project.id]: deriveProjectSourceFromProject(project) || result?.import_source || "project_file",
      };
      safeWriteProjectSources(nextSources);
      return {
        currentProject: project,
        importWarnings: Array.isArray(result.warnings) ? result.warnings : [],
        projects,
        lastOpenedProjectId: project.id,
        projectSources: nextSources,
        projectFileBindings: nextBindings,
        currentProjectFileHandle: binding.handle,
        currentProjectFileName: binding.fileName,
      };
    });
    useUiStore.getState().pushToast({
      title: result?.open_mode === "reused" ? `已继续编辑项目：${project.name}` : `项目文件打开完成：${project.name}`,
      tone: "success",
    });
    if (Array.isArray(result.warnings) && result.warnings.length) {
      result.warnings.forEach((warning, index) => {
        useUiStore.getState().pushToast({
          title: `打开提示 ${index + 1}/${result.warnings.length}：${warning}`,
          tone: "warning",
        });
      });
    }
    return { ...result, project };
  },
  getLastOpenedProjectId: () => get().lastOpenedProjectId,
}));
