import { useState, useEffect, useRef, useCallback } from 'react';

interface UseJobWebSocketOptions {
  jobId: number;
  enabled?: boolean;
}

export interface ChunkMessage {
  type: 'chunk';
  chunk: string;
  logType: string;
}

export function useJobWebSocket({ jobId, enabled = true }: UseJobWebSocketOptions) {
  const [logs, setLogs] = useState<string>('');
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

    if (!enabled) {
      setLogs('');
      return;
    }

    function connect() {
      if (!mountedRef.current) return;
      try {
        const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws?jobId=${jobId}`;
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
            const data = JSON.parse(event.data as string) as ChunkMessage;
            if (data.type === 'chunk' && data.chunk) {
              setLogs((prev) => prev + data.chunk);
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
    connect();

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [jobId, enabled]);

  const clearLogs = useCallback(() => setLogs(''), []);

  return { logs, isConnected, clearLogs };
}
