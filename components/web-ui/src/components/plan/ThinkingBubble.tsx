import * as React from 'react';
import { useChatWebSocket, LogMessage } from '@/hooks/useChatWebSocket';
import { Loader2 } from 'lucide-react';

interface ThinkingBubbleProps {
  chatId: number;
}

export function ThinkingBubble({ chatId }: ThinkingBubbleProps) {
  const { messages } = useChatWebSocket({ chatId });
  const contentRef = React.useRef<HTMLDivElement>(null);
  const userScrolledAwayRef = React.useRef(false);

  const content = React.useMemo(() => {
    return messages.reduce((acc, m: LogMessage) => acc + m.line, '');
  }, [messages]);

  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (!userScrolledAwayRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;
    const threshold = Math.min(50, maxScroll);
    const atBottom = el.scrollTop >= maxScroll - threshold;
    userScrolledAwayRef.current = !atBottom;
  };

  return (
    <div className="p-4 bg-muted rounded-lg border">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-muted-foreground">Thinking...</span>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
      <div
        ref={contentRef}
        onScroll={handleScroll}
        className="whitespace-pre-wrap text-sm text-primary overflow-auto"
        style={{ maxHeight: '10em' }}
      >
        {content}
      </div>
    </div>
  );
}