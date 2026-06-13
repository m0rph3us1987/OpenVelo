
import { useState, useEffect, useRef, useCallback } from 'react';
import { wsManager } from '@/lib/websocket-manager';
import type { WsMessage } from '@/lib/types';

interface UseWebSocketOptions {
  projectId: number;
  enabled: boolean;
}

export function useWebSocket({ projectId, enabled }: UseWebSocketOptions) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;
      try {
        const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.hostname}:${wsPort}/ws?projectId=${projectId}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setIsConnected(true);
          retryCountRef.current = 0;
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const msg = JSON.parse(event.data as string) as WsMessage;
            setMessages((prev) => [...prev.slice(-200), msg]);
          } catch {
            // ignore malformed
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          setIsConnected(false);
          wsRef.current = null;
          if (enabled) {
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
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        // Synchronously remove this socket from the manager so a subsequent
        // effect run (e.g. React 19 StrictMode dev double-mount, or a re-render
        // that recreates the connection) cannot broadcast to a stale socket.
        wsManager.unregister(ws);
        ws.onclose = null;
        ws.onerror = null;
        wsRef.current = null;
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [projectId, enabled]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isConnected, clearMessages };
}
