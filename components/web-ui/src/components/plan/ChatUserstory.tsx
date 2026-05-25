import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';

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
    return (
      <div data-testid="error-message" className="flex items-center justify-center h-full text-muted-foreground">
        Error generating story
      </div>
    );
  }

  return null;
}