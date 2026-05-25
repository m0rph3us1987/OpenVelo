import { useState, useEffect, useRef, useCallback } from 'react';

interface UseChatWebSocketOptions {
  chatId: number;
  enabled?: boolean;
}

export interface LogMessage {
  line: string;
}

export function useChatWebSocket({ chatId, enabled = true }: UseChatWebSocketOptions) {
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<(() => void) | null>(null);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    intentionalCloseRef.current = false;

    function connect() {
      if (!mountedRef.current) return;
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws?chatId=${chatId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setIsConnected(true);
          retryCountRef.current = 0;
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const data = JSON.parse(event.data as string) as LogMessage;
            if (data.line) {
              setMessages((prev) => [...prev.slice(-500), data]);
            }
          } catch {
            // ignore malformed
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          setIsConnected(false);
          wsRef.current = null;
          if (enabled && !intentionalCloseRef.current) {
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
            retryCountRef.current += 1;
            retryTimerRef.current = setTimeout(() => connectRef.current?.(), delay);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        // WebSocket not available
      }
    }

    connectRef.current = connect;
    if (enabled) connect();

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [chatId, enabled]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isConnected, clearMessages };
}