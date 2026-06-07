import { useEffect, useRef, useState } from "react";

export function useWebSocket(url, options = {}) {
  const {
    enabled = true,
    maxRetries = 5,
    baseDelay = 1000,
    onOpen,
    onMessage,
    onError,
    onClose,
    trackLastMessage = true,
  } = options;

  const socketRef = useRef(null);
  const retriesRef = useRef(0);
  const closedByUserRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);

  const [lastMessage, setLastMessage] = useState(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    onOpenRef.current = onOpen;
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onCloseRef.current = onClose;
  }, [onOpen, onMessage, onError, onClose]);

  useEffect(() => {
    if (!url || !enabled) {
      return undefined;
    }
    closedByUserRef.current = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (closedByUserRef.current) {
        return;
      }
      setStatus(retriesRef.current > 0 ? "reconnecting" : "connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = (event) => {
        retriesRef.current = 0;
        setStatus("open");
        if (onOpenRef.current) {
          onOpenRef.current(event);
        }
      };

      socket.onmessage = (event) => {
        if (trackLastMessage) {
          setLastMessage(event.data);
        }
        if (onMessageRef.current) {
          onMessageRef.current(event);
        }
      };

      socket.onerror = (event) => {
        if (onErrorRef.current) {
          onErrorRef.current(event);
        }
      };

      socket.onclose = (event) => {
        if (onCloseRef.current) {
          onCloseRef.current(event);
        }
        if (closedByUserRef.current) {
          setStatus("closed");
          return;
        }
        if (retriesRef.current >= maxRetries) {
          setStatus("failed");
          return;
        }
        retriesRef.current += 1;
        const delay = baseDelay * (2 ** (retriesRef.current - 1));
        setStatus("reconnecting");
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      clearReconnectTimer();
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // ignore close error
        }
      }
      socketRef.current = null;
      setStatus("closed");
    };
  }, [url, enabled, maxRetries, baseDelay]);

  return { socket: socketRef.current, lastMessage, status };
}
