import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { MobileChatListView } from './plan/MobileChatListView';
import { MobileChatPanelView } from './plan/MobileChatPanelView';
import { useViewStack } from './plan/useViewStack';
import { useChatListWebSocket } from '@/hooks/useChatListWebSocket';
import { useToast } from '@/context/ToastContext';
import type { ChatSession, Project } from '@/lib/types';

interface ProjectContext {
  project: Project;
  projectId: number;
  liveStatus: 'running' | 'stopped' | undefined;
}

export function MobilePlanPage() {
  const { projectId } = useOutletContext<ProjectContext>();
  const stack = useViewStack();
  const [chats, setChats] = React.useState<ChatSession[]>([]);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [phase, setPhase] = React.useState<'list' | 'panel'>(stack.view);
  const scrollPositionsRef = React.useRef<Map<number, number>>(new Map());
  const { showToast } = useToast();
  const skipNextPhaseSync = React.useRef(false);

  useChatListWebSocket(projectId, {
    onChatUpdated: (chatId, stage, sub_stage, error_type, running) => {
      setChats((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                stage,
                sub_stage,
                error_type: error_type ?? chat.error_type,
                running: running !== undefined ? running : chat.running,
              }
            : chat
        );
      });
    },
    onChatCreated: (chat) => {
      const next = chat as ChatSession;
      setChats((prev) => (prev.some((c) => c.id === next.id) ? prev : [next, ...prev]));
    },
    onChatDeleted: (chatId) => {
      setChats((prev) => prev.filter((chat) => chat.id !== chatId));
      if (stack.activeChatId === chatId) {
        stack.back();
      }
    },
  });

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/chats?projectId=${projectId}`);
        if (!res.ok) return;
        const data = (await res.json()) as ChatSession[];
        if (!cancelled) {
          setChats(data);
          setListLoaded(true);
        }
      } catch {
        if (!cancelled) setListLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  React.useEffect(() => {
    if (!listLoaded) return;
    if (stack.activeChatId === null) {
      setPhase('list');
      return;
    }
    const exists = chats.some((c) => c.id === stack.activeChatId);
    if (!exists) {
      skipNextPhaseSync.current = true;
      showToast('Chat not found', 'error');
      stack.back();
    }
  }, [listLoaded, chats, stack.activeChatId]);

  React.useEffect(() => {
    if (skipNextPhaseSync.current) {
      skipNextPhaseSync.current = false;
      return;
    }
    setPhase(stack.view);
  }, [stack.view]);

  React.useEffect(() => {
    function onPop() {
      if (stack.activeChatId !== null) {
        stack.back();
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [stack]);

  const activeChat = React.useMemo<ChatSession | null>(() => {
    if (stack.activeChatId === null) return null;
    return chats.find((c) => c.id === stack.activeChatId) ?? null;
  }, [chats, stack.activeChatId]);

  return (
    <div
      role="main"
      className="relative h-full min-h-0 overflow-hidden"
      data-testid="mobile-plan-page"
    >
      <div
        className={
          'absolute inset-0 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ' +
          (phase === 'list' ? 'translate-x-0' : '-translate-x-full')
        }
      >
        <MobileChatListView
          projectId={projectId}
          onSelect={(chat) => {
            stack.push(chat.id);
            scrollPositionsRef.current.set(chat.id, 0);
          }}
        />
      </div>

      <div
        aria-hidden={phase === 'list'}
        className={
          'absolute inset-0 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ' +
          (phase === 'panel' ? 'translate-x-0' : 'translate-x-full')
        }
      >
        {activeChat && (
          <MobileChatPanelView
            chat={activeChat}
            onBack={stack.back}
            onSwitchChat={(id) => stack.select(id)}
            scrollPositionsRef={scrollPositionsRef}
          />
        )}
        {!activeChat && phase === 'panel' && (
          <div className="flex h-full items-center justify-center text-mobile-caption text-muted-foreground">
            Loading chat…
          </div>
        )}
      </div>
    </div>
  );
}
