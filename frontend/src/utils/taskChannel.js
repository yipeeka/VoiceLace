export function runTaskChannel({
  wsUrl,
  timeoutMs,
  maxReconnectRetries = 5,
  baseDelayMs = 1000,
  shouldReconnect = () => true,
  syncTaskState = async () => false,
  onConnectionStatus = () => {},
  onOpen = async () => {},
  onMessage = () => {},
  onReconnectScheduled = () => {},
  onReconnectExhausted = () => {},
  onTimeout = () => {},
}) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let finished = false;
    let reconnectAttempts = 0;
    let timeoutId = null;

    const clearTimer = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const closeSocket = () => {
      try {
        ws?.close();
      } catch {
        // ignore close errors
      }
    };

    const done = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimer();
      onConnectionStatus("closed");
      closeSocket();
      resolve(value);
    };

    const fail = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimer();
      onConnectionStatus("closed");
      closeSocket();
      reject(error instanceof Error ? error : new Error(String(error || "Task channel failed")));
    };

    const scheduleReconnect = () => {
      if (finished) {
        return;
      }
      if (reconnectAttempts >= maxReconnectRetries) {
        onConnectionStatus("closed");
        const exhaustedError = onReconnectExhausted();
        fail(exhaustedError || new Error("task channel reconnect exhausted"));
        return;
      }
      reconnectAttempts += 1;
      const delay = baseDelayMs * (2 ** (reconnectAttempts - 1));
      onConnectionStatus("reconnecting");
      onReconnectScheduled({ reconnectAttempts, delay });
      window.setTimeout(async () => {
        if (finished) {
          return;
        }
        const recovered = await syncTaskState({ done, fail, closeSocket });
        if (recovered) {
          return;
        }
        connect();
      }, delay);
    };

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = async () => {
        onConnectionStatus("open");
        await onOpen({ isReconnect: reconnectAttempts > 0, reconnectAttempts });
      };

      ws.onmessage = (event) => {
        let msg = null;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        onMessage({ msg, done, fail, closeSocket });
      };

      ws.onerror = () => {
        // reconnect handled by onclose
      };

      ws.onclose = () => {
        if (finished) {
          onConnectionStatus("closed");
          return;
        }
        if (!shouldReconnect()) {
          onConnectionStatus("closed");
          return;
        }
        scheduleReconnect();
      };
    };

    timeoutId = window.setTimeout(() => {
      if (finished) {
        return;
      }
      const timeoutError = onTimeout();
      fail(timeoutError || new Error("task channel timeout"));
    }, timeoutMs);

    onConnectionStatus("connecting");
    connect();
  });
}
