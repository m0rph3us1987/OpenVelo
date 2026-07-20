import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileConfirmDialog } from '@/components/ui/mobile-confirm-dialog';
import { useChatListWebSocket } from '@/hooks/useChatListWebSocket';
import { useToast } from '@/context/ToastContext';
import type { ChatSession } from '@/lib/types';
import { MobileNewChatSheet } from './MobileNewChatSheet';

interface MobileChatListViewProps {
  projectId: number;
  onSelect: (chat: ChatSession) => void;
}

export function MobileChatListView({ projectId, onSelect }: MobileChatListViewProps) {
  const [chats, setChats] = React.useState<ChatSession[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const { showToast } = useToast();

  const fetchChats = React.useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/chats?projectId=${projectId}`);
      if (res.ok) {
        const data = (await res.json()) as ChatSession[];
        setChats(data);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useChatListWebSocket(projectId, {
    onChatUpdated: (chatId, stage, sub_stage, error_type, running) => {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                stage,
                sub_stage,
                error_type: error_type ?? chat.error_type,
                running: running !== undefined ? running : chat.running,
              }
            : chat
        )
      );
    },
    onChatCreated: (chat) => {
      setChats((prev) => [chat as ChatSession, ...prev]);
    },
    onChatDeleted: (chatId) => {
      setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    },
  });

  async function handleOpen(chat: ChatSession) {
    try {
      await fetch('/api/chatOpen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chat.id, project_id: projectId }),
      });
      onSelect(chat);
    } catch {
      showToast('Failed to open chat', 'error');
    }
  }

  function requestDelete(e: React.MouseEvent, chatId: number) {
    e.stopPropagation();
    setDeleteTargetId(chatId);
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (deleteTargetId === null) return;
    try {
      const res = await fetch('/api/chatDelete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTargetId }),
      });
      if (!res.ok) {
        showToast('Failed to delete chat', 'error');
      }
    } catch {
      showToast('Failed to delete chat', 'error');
    } finally {
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    }
  }

  return (
    <div role="main" className="flex h-full flex-col">
      <div className="border-b border-border px-4 pt-safe-top pb-3">
        <h1 className="text-mobile-h2">Chats</h1>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-destructive/10 px-4 py-2 text-mobile-caption text-destructive">
          <span>Could not load chats.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchChats()}
            className="tap-target"
          >
            Retry
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading && (
          <ul className="flex flex-col" aria-label="Loading chats">
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={i}
                className="mx-4 my-2 h-12 animate-pulse rounded-md bg-muted"
                aria-hidden="true"
              />
            ))}
          </ul>
        )}

        {!loading && chats.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="text-mobile-body text-muted-foreground">No chats yet</p>
            <p className="text-mobile-caption text-muted-foreground">
              Start a new planning session to begin.
            </p>
          </div>
        )}

        {!loading && chats.length > 0 && (
          <ul className="flex flex-col">
            {chats.map((chat) => (
              <li key={chat.id} className="border-b border-border/50 last:border-b-0">
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => void handleOpen(chat)}
                    className="tap-target active:bg-muted flex-1 px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-mobile-body font-medium">{chat.name}</span>
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-mobile-caption text-primary capitalize">
                        {chat.mode}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-mobile-caption text-muted-foreground">
                      <span>Stage: {chat.stage}</span>
                      {chat.error_type && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                          {chat.error_type === 'missing_repository' ? 'No repository' : 'Error'}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => requestDelete(e, chat.id)}
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="tap-target active:bg-destructive/10 active:text-destructive shrink-0 px-4 text-muted-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MobileConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete chat?"
        description="This action cannot be undone. The chat and all its data will be permanently removed."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
      />

      <NewChatCta onCreated={(chat) => void handleOpen(chat)} projectId={projectId} />
    </div>
  );
}

function NewChatCta({ onCreated, projectId }: { onCreated: (c: ChatSession) => void; projectId: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="border-t border-border p-3 pb-safe-bottom">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="tap-target-lg w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <MobileNewChatSheet
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        onCreated={(c) => {
          setOpen(false);
          onCreated(c);
        }}
      />
    </>
  );
}
