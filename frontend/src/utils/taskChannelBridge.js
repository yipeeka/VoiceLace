import { getLanguage } from "../i18n/core";
import { MESSAGES } from "../i18n/messages";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

export function createTaskChannelBridge({
  set,
  getStatus,
  maxReconnectRetries = 5,
  exhaustedMessage,
  timeoutMessage,
  onReconnectScheduledExtra,
  onExhaustedExtra,
  onTimeoutExtra,
  onReconnectOpenExtra,
}) {
  return {
    shouldReconnect: () => {
      const status = getStatus();
      return status !== "cancel_requested" && status !== "canceled";
    },
    onConnectionStatus: (connectionStatus) => set({ connectionStatus }),
    onOpen: async ({ isReconnect }) => {
      set({ modelStatus: t("util.taskBridge.connected") });
      if (isReconnect && typeof onReconnectOpenExtra === "function") {
        await onReconnectOpenExtra();
      }
    },
    onReconnectScheduled: ({ reconnectAttempts, delay }) => {
      set({
        modelStatus: t("util.taskBridge.reconnectScheduled", {
          delay,
          reconnectAttempts,
          maxReconnectRetries,
        }),
      });
      if (typeof onReconnectScheduledExtra === "function") {
        onReconnectScheduledExtra({ reconnectAttempts, delay });
      }
    },
    onReconnectExhausted: () => {
      if (typeof onExhaustedExtra === "function") {
        onExhaustedExtra();
      }
      return new Error(exhaustedMessage);
    },
    onTimeout: () => {
      if (typeof onTimeoutExtra === "function") {
        onTimeoutExtra();
      }
      return new Error(timeoutMessage);
    },
  };
}
