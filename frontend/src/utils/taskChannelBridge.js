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
      set({ modelStatus: "连接已建立" });
      if (isReconnect && typeof onReconnectOpenExtra === "function") {
        await onReconnectOpenExtra();
      }
    },
    onReconnectScheduled: ({ reconnectAttempts, delay }) => {
      set({
        modelStatus: `连接中断，${delay}ms 后尝试重连 (${reconnectAttempts}/${maxReconnectRetries})...`,
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
