import { create } from "zustand";

import { api } from "../utils/api.js";
import { formatError } from "../utils/errors.js";
import {
  deriveProjectSourceFromProject,
  getCurrentBindingState,
  mergeProjectSourcesFromSummaries,
  safeReadLastOpenedProjectId,
  safeReadProjectSources,
  safeWriteLastOpenedProjectId,
  safeWriteProjectSources,
  sortProjectSummaries,
  toProjectSummary,
  upsertProjectSummary,
} from "../utils/projectLifecycle.js";
import { useUiStore } from "./useUiStore.js";

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
