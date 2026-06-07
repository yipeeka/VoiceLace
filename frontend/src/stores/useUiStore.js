import { create } from "zustand";

export const useUiStore = create((set) => ({
  toasts: [],
  projectSaveAction: null,
  confirmDialog: null,
  promptDialog: null,
  setProjectSaveAction: (action) => set({ projectSaveAction: action }),
  clearProjectSaveAction: () => set({ projectSaveAction: null }),
  requestConfirm: (options = {}) =>
    new Promise((resolve) => {
      set({
        confirmDialog: {
          title: String(options.title || "确认操作"),
          description: String(options.description || ""),
          confirmLabel: String(options.confirmLabel || "确认"),
          cancelLabel: String(options.cancelLabel || "取消"),
          danger: Boolean(options.danger),
          resolve,
        },
      });
    }),
  resolveConfirm: (confirmed) =>
    set((state) => {
      state.confirmDialog?.resolve?.(Boolean(confirmed));
      return { confirmDialog: null };
    }),
  requestPrompt: (options = {}) =>
    new Promise((resolve) => {
      set({
        promptDialog: {
          title: String(options.title || "输入内容"),
          description: String(options.description || ""),
          label: String(options.label || ""),
          defaultValue: String(options.defaultValue || ""),
          placeholder: String(options.placeholder || ""),
          confirmLabel: String(options.confirmLabel || "确认"),
          cancelLabel: String(options.cancelLabel || "取消"),
          resolve,
        },
      });
    }),
  resolvePrompt: (value) =>
    set((state) => {
      state.promptDialog?.resolve?.(value === null ? null : String(value ?? ""));
      return { promptDialog: null };
    }),
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
