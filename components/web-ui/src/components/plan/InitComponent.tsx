import * as React from 'react';
import { FileText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChatSession } from '@/lib/types';

interface InitComponentProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

export function InitComponent({ chat, onHeaderInfo }: InitComponentProps) {
  const [input, setInput] = React.useState('');

  React.useEffect(() => {
    onHeaderInfo?.({
      title: `${chat.name} - ready`,
      showSpinner: false,
    });
  }, [chat.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">{chat.name}</h2>
          <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary capitalize">
            {chat.mode}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          Stage: {chat.stage} {chat.sub_stage && `/ ${chat.sub_stage}`}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-sm">No messages yet</p>
          <p className="text-xs mt-1">Send a message to start the conversation</p>
        </div>
      </div>

      <div className="p-4 border-t border-border">
        <form className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
          />
          <Button type="submit" size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}