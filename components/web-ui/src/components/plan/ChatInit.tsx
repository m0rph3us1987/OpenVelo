import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';

interface ChatInitProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

export function ChatInit({ chat, onHeaderInfo }: ChatInitProps) {
  const { subStage } = useStageWebSocket({ chatId: chat.id, stage: 'init' });

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'init': 'Initializing',
      'cloning': 'Cloning repository',
      'starting': 'Starting OpenCode server',
    };
    const subtitle = titleMap[subStage] ?? 'Initializing';

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: true,
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  return <TextLog chatId={chat.id} />;
}