import * as React from 'react';
import { useChatWebSocket, LogMessage } from '@/hooks/useChatWebSocket';

interface TextLogProps {
  chatId: number;
  className?: string;
  clearKey?: string | number;
}

export function TextLog({ chatId, className, clearKey }: TextLogProps) {
  const { messages } = useChatWebSocket({ chatId });
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const userScrolledAwayRef = React.useRef(false);

  const content = React.useMemo(() => {
    return messages.reduce((acc, m: LogMessage) => acc + m.line, '');
  }, [messages, clearKey]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleScroll = () => {
      const maxScroll = textarea.scrollHeight - textarea.clientHeight;
      if (maxScroll <= 0) return;
      const threshold = Math.min(50, maxScroll);
      const atBottom = textarea.scrollTop >= maxScroll - threshold;
      userScrolledAwayRef.current = !atBottom;
    };

    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, []);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!userScrolledAwayRef.current) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [content]);

  return (
    <textarea
      key={clearKey}
      ref={textareaRef}
      value={content}
      readOnly
      className={`w-full h-full bg-background border border-border rounded-lg p-4 font-mono text-sm text-primary resize-none focus:outline-none focus:ring-0 ${className ?? ''}`}
      placeholder="Waiting for logs..."
    />
  );
}