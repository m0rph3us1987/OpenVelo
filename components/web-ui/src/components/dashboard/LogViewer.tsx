import * as React from 'react';
import AnsiToHtml from 'ansi-to-html';
import { cn } from '@/lib/utils';
import type { WsLogMessage } from '@/lib/types';

const ansiConverter = new AnsiToHtml({ fg: '#d4d4d4', bg: 'transparent', newline: false, escapeXML: true });

function ansiToHtml(text: string): string {
  try {
    return ansiConverter.toHtml(text);
  } catch {
    return text;
  }
}

interface LogViewerProps {
  logs?: string | null;
  liveLogs?: string | null;
  className?: string;
}

export function LogViewer({ logs, liveLogs, className }: LogViewerProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const lines = React.useMemo(() => {
    const staticContent = logs ?? '';
    const streamingContent = liveLogs ?? '';
    const combined = staticContent + streamingContent;
    return combined.split('\n').slice(-1000);
  }, [logs, liveLogs]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const hasContent = lines.some(line => line.length > 0);

  if (!hasContent) {
    return (
      <div className={cn('flex items-center justify-center h-24 text-muted-foreground text-sm', className)}>
        No logs yet
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn('h-48 sm:h-64 overflow-y-auto rounded-md border border-border bg-black/30 font-mono text-xs', className)}
    >
      <div className="p-3 space-y-0.5">
        {lines.map((line, i) => {
          const isError = line.includes('[ERROR]') || line.includes('error');
          const isWarn = line.includes('[WARN]') || line.includes('warning');
          const isStatus = line.includes('[STAGE]') || line.includes('[status]');
          const colorClass = isError ? 'text-red-400' : isWarn ? 'text-amber-400' : isStatus ? 'text-blue-400' : 'text-muted-foreground';
          return (
            <div key={i} className={cn('whitespace-pre-wrap break-all leading-5', colorClass)}>
              <span dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}