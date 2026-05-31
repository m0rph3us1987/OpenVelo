import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Button } from '@/components/ui/button';

interface ChatUserstoryProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

export function ChatUserstory({ chat, onHeaderInfo }: ChatUserstoryProps) {
  const { subStage, progress } = useStageWebSocket({ chatId: chat.id, stage: 'quick_story' });

  React.useEffect(() => {
    let subtitle: string;
    if (progress) {
      subtitle = progress;
    } else if (subStage === '') {
      subtitle = 'Quick Story';
    } else if (subStage === 'generate') {
      subtitle = 'Generating story...';
    } else if (subStage === 'error') {
      subtitle = 'Error';
    } else {
      subtitle = 'Quick Story';
    }

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: subStage === '' || subStage === 'generate',
    });
  }, [chat.id, subStage, progress, chat.name, onHeaderInfo]);

  if (subStage === '' || subStage === 'generate') {
    return <TextLog key={chat.id} chatId={chat.id} />;
  }

  if (subStage === 'error') {
    const handleRetry = async () => {
      await fetch(`/api/chats/${chat.id}/quick-story/retry`, { method: 'POST' });
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <span>Error generating story</span>
        <Button onClick={handleRetry} variant="outline">Retry</Button>
      </div>
    );
  }

  return null;
}