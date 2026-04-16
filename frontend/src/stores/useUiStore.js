import { create } from "zustand";

export const useUiStore = create((set) => ({
  toasts: [],
  projectSaveAction: null,
  setProjectSaveAction: (action) => set({ projectSaveAction: action }),
  clearProjectSaveAction: () => set({ projectSaveAction: null }),
  pushToast: ({ title, tone = "default", description, duration }) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, title, tone, description, duration: duration ?? 4000 }],
    }));
    // Auto-remove after duration + transition time
    window.setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, (duration ?? 4000) + 600);
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
