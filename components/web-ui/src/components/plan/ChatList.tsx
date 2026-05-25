import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { NewChatModal } from './NewChatModal';
import { useChatListWebSocket } from '@/hooks/useChatListWebSocket';
import type { ChatSession } from '@/lib/types';

interface ChatListProps {
  projectId: number;
  onChatSelect?: (chat: ChatSession | null) => void;
  onChatDataUpdated?: (chat: ChatSession) => void;
  selectedChatId?: number | null;
  newChatModalOpen?: boolean;
  onNewChatModalChange?: (open: boolean) => void;
}

export function ChatList({ projectId, onChatSelect, onChatDataUpdated, selectedChatId, newChatModalOpen, onNewChatModalChange }: ChatListProps) {
  const [chats, setChats] = React.useState<ChatSession[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deleteTargetId, setDeleteTargetId] = React.useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [pendingSelectChat, setPendingSelectChat] = React.useState<ChatSession | null>(null);

  const modalOpen = newChatModalOpen ?? false;
  const setModalOpen = onNewChatModalChange ?? (() => {});

  React.useEffect(() => {
    if (pendingSelectChat !== null) {
      onChatSelect?.(pendingSelectChat);
      setPendingSelectChat(null);
    }
  }, [pendingSelectChat]);

  async function fetchChats() {
    try {
      const res = await fetch(`/api/chats?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setChats(data);
      }
    } catch (e) {
      console.error('Failed to fetch chats:', e);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchChats();
  }, [projectId]);

  useChatListWebSocket(projectId, {
    onChatUpdated: (chatId, stage, sub_stage, error_type) => {
      setChats((prev) => {
        const updated = prev.map((chat) =>
          chat.id === chatId ? { ...chat, stage, sub_stage, error_type } : chat
        );
        if (chatId === selectedChatId) {
          const updatedChat = updated.find((c) => c.id === chatId);
          if (updatedChat) {
            requestAnimationFrame(() => {
              onChatDataUpdated?.(updatedChat);
            });
          }
        }
        return updated;
      });
    },
    onChatCreated: (chat) => {
      setChats((prev) => [chat as ChatSession, ...prev]);
    },
    onChatDeleted: (chatId) => {
      setChats((prev) => prev.filter((chat) => chat.id !== chatId));
      if (chatId === selectedChatId) {
        onChatSelect?.(null);
      }
    },
  });

  async function handleChatOpen(chat: ChatSession) {
    try {
      await fetch('/api/chatOpen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chat.id, project_id: projectId }),
      });
      onChatSelect?.(chat);
    } catch (e) {
      console.error('Failed to open chat:', e);
    }
  }

  async function handleChatCreated(chat: ChatSession) {
    setModalOpen(false);
    try {
      await fetch('/api/chatOpen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chat.id, project_id: projectId }),
      });
    } catch (e) {
      console.error('Failed to open chat:', e);
    }
    onChatSelect?.(chat);
  }

  function handleDeleteClick(e: React.MouseEvent, chatId: number) {
    e.stopPropagation();
    setDeleteTargetId(chatId);
    setShowDeleteDialog(true);
  }

  async function handleConfirmDelete() {
    if (deleteTargetId === null) return;
    try {
      const res = await fetch('/api/chatDelete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTargetId }),
      });
      if (res.ok) {
        fetchChats();
      }
    } catch (e) {
      console.error('Failed to delete chat:', e);
    } finally {
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    }
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading...</div>
        )}
        {!loading && chats.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No chats yet</div>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            role="button"
            tabIndex={0}
            onClick={() => handleChatOpen(chat)}
            onKeyDown={(e) => e.key === 'Enter' && handleChatOpen(chat)}
            className="w-full p-3 text-left hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0 flex items-center justify-between cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm truncate">{chat.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary capitalize">
                  {chat.mode}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Stage: {chat.stage}</span>
                {chat.error_type && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                    {chat.error_type === 'missing_repository' ? 'No repository' : 'Error'}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={(e) => handleDeleteClick(e, chat.id)}
              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded transition-colors ml-2 shrink-0"
              title="Delete chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <NewChatModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        projectId={projectId}
        onCreated={handleChatCreated}
      />

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Chat?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The chat and all its data will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}