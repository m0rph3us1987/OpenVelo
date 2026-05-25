import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';

interface ChatAnalysisProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

export function ChatAnalysis({ chat, onHeaderInfo }: ChatAnalysisProps) {
  const { subStage } = useStageWebSocket({ chatId: chat.id, stage: 'analyzing' });

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      '': 'Setup',
      'analyzing': 'Analyzing repository...',
    };
    const subtitle = titleMap[subStage] ?? 'Setup';

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: true,
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  return <TextLog key={chat.id} chatId={chat.id} />;
}