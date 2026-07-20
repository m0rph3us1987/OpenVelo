import * as React from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ChatSession } from '@/lib/types';

interface MobileChatPanelHeaderProps {
  chat: ChatSession;
  showSpinner: boolean;
  onBack: () => void;
}

export function MobileChatPanelHeader({ chat, showSpinner, onBack }: MobileChatPanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 pt-safe-top pb-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="tap-target active:bg-muted inline-flex items-center justify-center rounded-md"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-mobile-body font-medium">{chat.name}</div>
        <div className="truncate text-mobile-caption text-muted-foreground capitalize">
          {chat.mode} · {chat.stage}
        </div>
      </div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
        {showSpinner ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
    </div>
  );
}
