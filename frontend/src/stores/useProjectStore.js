import { create } from "zustand";

import { api } from "../utils/api";
import { formatError } from "../utils/errors";
import { useUiStore } from "./useUiStore";

export const useProjectStore = create((set) => ({
  currentProject: null,
  projects: [],
  projectEvents: [],
  isLoading: false,
  setCurrentProject: (project) => set({ currentProject: project }),
  setProjects: (projects) => set({ projects }),
  loadProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await api.get("/projects");
      set({ projects, isLoading: false });
      return projects;
    } catch (error) {
      set({ isLoading: false });
      useUiStore.getState().pushToast({ title: formatError("项目列表加载失败", error), tone: "error" });
      throw error;
    }
  },
  createProject: async (name) => {
    const project = await api.post("/projects", { name });
    set((state) => ({
      currentProject: project,
      projects: [
        { id: project.id, name: project.name, status: project.status, updated_at: project.updated_at },
        ...state.projects.filter((item) => item.id !== project.id),
      ],
    }));
    useUiStore.getState().pushToast({ title: `已创建项目：${project.name}`, tone: "success" });
    return project;
  },
  selectProject: async (projectId) => {
    const project = await api.get(`/projects/${projectId}`);
    set({ currentProject: project });
    useUiStore.getState().pushToast({ title: `已切换到项目：${project.name}`, tone: "default" });
    return project;
  },
  refreshCurrentProject: async (projectId) => {
    const project = await api.get(`/projects/${projectId}`);
    set((state) => ({
      currentProject: project,
      projects: state.projects.map((item) =>
        item.id === project.id
          ? { id: project.id, name: project.name, status: project.status, updated_at: project.updated_at }
          : item,
      ),
    }));
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
      const projects = state.projects.filter((item) => item.id !== projectId);
      const currentProject = state.currentProject?.id === projectId ? null : state.currentProject;
      return {
        projects,
        currentProject,
        projectEvents: currentProject ? state.projectEvents : [],
      };
    });
    useUiStore.getState().pushToast({ title: "项目已删除", tone: "success" });
  },
}));
