import { useEffect, useRef } from 'react';

type ChatListEventType = 'chat_updated' | 'chat_created' | 'chat_deleted';

interface ChatListEvent {
  type: ChatListEventType;
  chatId?: number;
  stage?: string;
  sub_stage?: string;
  error_type?: string;
  status?: string;
  chat?: unknown;
  running?: number;
}

type ChatEventHandlers = {
  onChatUpdated?: (chatId: number, stage: string, sub_stage: string, error_type?: string, running?: number, status?: string) => void;
  onChatCreated?: (chat: unknown) => void;
  onChatDeleted?: (chatId: number) => void;
};

export function useChatListWebSocket(
  projectId: number,
  handlers: ChatEventHandlers,
  enabled: boolean = true
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let mounted = true;

    function connect() {
      if (!mounted) return;

      try {
        const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${wsProtocol}//${window.location.hostname}:${wsPort}/ws?projectId=${projectId}`);

        ws.onopen = () => {
          if (!mounted) return;
          retryCount = 0;
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const msg = JSON.parse(event.data as string) as ChatListEvent;
            if (msg.type === 'chat_updated' && msg.chatId !== undefined && msg.stage !== undefined && msg.sub_stage !== undefined) {
              handlersRef.current.onChatUpdated?.(msg.chatId, msg.stage, msg.sub_stage, msg.error_type, msg.running, msg.status);
            } else if (msg.type === 'chat_created' && msg.chat !== undefined) {
              handlersRef.current.onChatCreated?.(msg.chat);
            } else if (msg.type === 'chat_deleted' && msg.chatId !== undefined) {
              handlersRef.current.onChatDeleted?.(msg.chatId);
            }
          } catch {
            // ignore malformed
          }
        };

        ws.onclose = () => {
          if (!mounted) return;
          if (enabled) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
            retryCount += 1;
            retryTimer = setTimeout(connect, delay);
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available
      }
    }

    connect();

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    };
  }, [projectId, enabled]);
}