import { create } from "zustand";

import { api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { useUiStore } from "./useUiStore";

export const useScriptStore = create((set) => ({
  sourceText: "",
  llmStreamOutput: "",
  parseProgress: 0,
  parseTaskId: null,
  isParsing: false,
  isSaving: false,
  error: "",
  script: {
    title: "",
    source_text: "",
    segments: [],
    characters: [],
    metadata: {},
  },
  setSourceText: (sourceText) => set({ sourceText }),
  setLlmStreamOutput: (llmStreamOutput) => set({ llmStreamOutput }),
  setScript: (script) => set({ script }),
  loadProjectScript: async (projectId) => {
    const script = await api.get(`/projects/${projectId}/script`);
    set({ script, sourceText: script.source_text || "" });
    return script;
  },
  parseText: async ({ text, projectId, prompt }) => {
    set({ isParsing: true, error: "", parseProgress: 5, llmStreamOutput: "", parseTaskId: null });
    try {
      const { task_id: taskId } = await api.post("/llm/parse", {
        text,
        system_prompt: prompt,
        project_id: projectId,
      });
      set({ parseTaskId: taskId });
      const wsUrl = `${getWsBaseUrl()}/ws/llm-stream/${taskId}`;

      return await new Promise((resolve, reject) => {
        let ws = null;
        let finished = false;
        let reconnectAttempts = 0;
        const maxReconnectRetries = 5;
        const baseDelay = 1000;

        const finalizeWithScript = (script) => {
          finished = true;
          window.clearTimeout(timeout);
          set({
            isParsing: false,
            parseProgress: 100,
            script,
            llmStreamOutput: JSON.stringify(script, null, 2),
            parseTaskId: null,
          });
          useUiStore.getState().pushToast({ title: `解析完成，生成 ${script.segments.length} 个片段`, tone: "success" });
          ws?.close();
          resolve(script);
        };

        const syncTaskState = async () => {
          try {
            const state = await api.get(`/llm/parse/${taskId}`);
            if (state && Array.isArray(state.segments)) {
              finalizeWithScript(state);
              return true;
            }
            return false;
          } catch {
            return false;
          }
        };

        const scheduleReconnect = () => {
          if (finished) {
            return;
          }
          if (reconnectAttempts >= maxReconnectRetries) {
            window.clearTimeout(timeout);
            set({
              isParsing: false,
              error: "解析连接已关闭（重连失败）",
              parseProgress: 0,
              parseTaskId: null,
            });
            reject(new Error("解析连接已关闭（重连失败）"));
            return;
          }
          reconnectAttempts += 1;
          const delay = baseDelay * (2 ** (reconnectAttempts - 1));
          set((state) => ({
            llmStreamOutput: `${state.llmStreamOutput}\n[系统] 连接中断，${delay}ms 后尝试重连 (${reconnectAttempts}/${maxReconnectRetries})...\n`,
          }));
          window.setTimeout(async () => {
            if (finished) {
              return;
            }
            const recovered = await syncTaskState();
            if (recovered) {
              return;
            }
            connect();
          }, delay);
        };

        const connect = () => {
          ws = new WebSocket(wsUrl);

          ws.onopen = async () => {
            if (reconnectAttempts > 0) {
              set((state) => ({
                llmStreamOutput: `${state.llmStreamOutput}[系统] 连接已恢复。\n`,
              }));
              await syncTaskState();
            }
          };

          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case "task_status":
                set({ llmStreamOutput: `任务状态：${msg.status}\n` });
                break;
              case "model_loading":
              case "model_loaded":
              case "model_unloading":
              case "model_unloaded":
                set((state) => ({
                  llmStreamOutput: `${state.llmStreamOutput}${msg.message || msg.type}\n`,
                }));
                break;
              case "chunk":
                set((state) => ({
                  llmStreamOutput: `${state.llmStreamOutput}${msg.data}`,
                }));
                break;
              case "progress":
                set({ parseProgress: msg.percent || 0 });
                break;
              case "chunk_progress":
                set((state) => ({
                  parseProgress: msg.percent || state.parseProgress || 0,
                  llmStreamOutput: `${state.llmStreamOutput}\n[Chunk ${msg.chunk}/${msg.total_chunks}] ${msg.percent}%\n`,
                }));
                break;
              case "chunk_start":
                set((state) => ({
                  parseProgress: msg.percent || state.parseProgress || 0,
                  llmStreamOutput: `${state.llmStreamOutput}\n[Chunk ${msg.chunk}/${msg.total_chunks}] 开始处理...\n`,
                }));
                break;
              case "complete":
                finalizeWithScript(msg.data);
                break;
              case "error":
                finished = true;
                window.clearTimeout(timeout);
                set({
                  isParsing: false,
                  error: msg.message || "解析失败",
                  parseProgress: 0,
                  parseTaskId: null,
                });
                ws?.close();
                reject(new Error(msg.message || "解析失败"));
                break;
              case "canceled":
                finished = true;
                window.clearTimeout(timeout);
                set((state) => ({
                  isParsing: false,
                  parseProgress: 0,
                  parseTaskId: null,
                  llmStreamOutput: `${state.llmStreamOutput}\n[系统] 解析已中断\n`,
                }));
                ws?.close();
                resolve(null);
                break;
              case "cancel_requested":
                set((state) => ({
                  llmStreamOutput: `${state.llmStreamOutput}\n[系统] 正在中断...\n`,
                }));
                break;
              default:
                break;
            }
          };

          ws.onerror = () => {
            // handled by onclose reconnect flow
          };

          ws.onclose = () => {
            if (!finished) {
              scheduleReconnect();
            }
          };
        };

        const timeout = window.setTimeout(() => {
          if (!finished) {
            ws?.close();
            reject(new Error("解析任务等待超时"));
          }
        }, 20 * 60 * 1000);
        connect();
      });
    } catch (error) {
      const message = getErrorMessage(error, "解析失败");
      set({
        isParsing: false,
        error: message,
        parseProgress: 0,
        parseTaskId: null,
      });
      useUiStore.getState().pushToast({ title: formatError("解析失败", message), tone: "error" });
      throw error;
    }
  },
  cancelParse: async () => {
    const taskId = useScriptStore.getState().parseTaskId;
    if (!taskId) {
      return { status: "idle" };
    }
    const result = await api.post(`/llm/parse/${taskId}/cancel`, {});
    set({ isParsing: false, parseTaskId: null });
    useUiStore.getState().pushToast({ title: "已请求取消解析任务", tone: "default" });
    return result;
  },
  updateSegment: async ({ projectId, segmentId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.put(`/projects/${projectId}/script/segments/${segmentId}`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "片段已保存", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "保存片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("保存片段失败", message), tone: "error" });
      throw error;
    }
  },
  addSegment: async ({ projectId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.post(`/projects/${projectId}/script/segments`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "已新增片段", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "新增片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("新增片段失败", message), tone: "error" });
      throw error;
    }
  },
  deleteSegment: async ({ projectId, segmentId }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.delete(`/projects/${projectId}/script/segments/${segmentId}`);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "片段已删除", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "删除片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("删除片段失败", message), tone: "error" });
      throw error;
    }
  },
  replaceScript: async ({ projectId, script }) => {
    set({ isSaving: true, error: "" });
    try {
      const updated = await api.put(`/projects/${projectId}/script`, script);
      set({ script: updated, sourceText: updated.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: "剧本导入成功", tone: "success" });
      return updated;
    } catch (error) {
      const message = getErrorMessage(error, "剧本导入失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("剧本导入失败", message), tone: "error" });
      throw error;
    }
  },
}));
