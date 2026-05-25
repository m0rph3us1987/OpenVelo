import { useState, useEffect, useRef } from 'react';

interface StageMessage {
  type: 'sub_stage' | 'closed' | 'connected';
  sub_stage?: string;
  progress?: string;
  errorType?: string;
}

interface UseStageWebSocketOptions {
  chatId: number;
  stage: string;
  enabled?: boolean;
}

export function useStageWebSocket({ chatId, stage, enabled = true }: UseStageWebSocketOptions) {
  const [subStage, setSubStage] = useState<string>('');
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [errorType, setErrorType] = useState<string | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current || !enabled) return;
      try {
        const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.hostname}:${wsPort}/ws/stage/${stage}?chatId=${chatId}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setIsConnected(true);
          retryCountRef.current = 0;
          ws.send(JSON.stringify({ type: 'get_state' }));
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const msg = JSON.parse(event.data as string) as StageMessage;
            if (msg.type === 'sub_stage') {
              if (msg.sub_stage !== undefined) setSubStage(msg.sub_stage);
              if (msg.progress !== undefined) setProgress(msg.progress);
              if (msg.errorType !== undefined) setErrorType(msg.errorType);
            } else if (msg.type === 'closed') {
              ws.close();
            }
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
      if (wsRef.current) wsRef.current.close();
    };
  }, [chatId, stage, enabled]);

  return { subStage, progress, errorType, isConnected };
}