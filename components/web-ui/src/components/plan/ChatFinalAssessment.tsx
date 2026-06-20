import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Button } from '@/components/ui/button';
import { ThinkingBubble } from './ThinkingBubble';
import { Send } from 'lucide-react';

interface ChatMessage {
  id: number;
  project_id: number;
  chat_id: number;
  stage: string;
  role: 'user' | 'system';
  message: string;
  ready_for_next_stage: boolean;
  created_at: string;
  options?: Array<{recommended: boolean, option: string}>;
}

interface ChatFinalAssessmentProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatFinalAssessment({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatFinalAssessmentProps) {
  const { subStage: wsSubStage } = useStageWebSocket({ chatId: chat.id, stage: 'final_assessment', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'user') : wsSubStage;

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      '': 'Final assessment',
      'analysis': 'Analyzing',
      'system': 'Final questions',
      'user': 'Final questions',
    };
    const subtitle = titleMap[subStage] ?? 'Final assessment';
    const showSpinner = subStage === 'analysis' || subStage === 'system';

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner,
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  if (subStage === 'analysis') {
    return <TextLog key={chat.id} chatId={chat.id} />;
  }

  if (subStage === 'error') {
    const handleRetry = async () => {
      await fetch(`/api/chats/${chat.id}/final_assessment/retry`, { method: 'POST' });
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <span>Error in final assessment</span>
        <Button onClick={handleRetry} variant="outline">Retry</Button>
      </div>
    );
  }

  return <FinalAssessmentChat chat={chat} subStage={subStage} viewOnly={viewOnly} />;
}

function FinalAssessmentChat({ chat, subStage, viewOnly }: { chat: ChatSession; subStage: string; viewOnly?: boolean }) {
  const [inputValue, setInputValue] = React.useState('');
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [readyForNextStage, setReadyForNextStage] = React.useState(false);
  const [transitioning, setTransitioning] = React.useState(false);
  const chatAreaRef = React.useRef<HTMLDivElement>(null);

  const fetchMessages = React.useCallback(() => {
    fetch(`/api/chats/chatMessages?chatId=${chat.id}`)
      .then(res => res.json())
      .then((data: ChatMessage[]) => {
        setChatMessages(data);
        const latestSystem = [...data].reverse().find(m => m.role === 'system');
        if (latestSystem?.ready_for_next_stage) {
          setReadyForNextStage(true);
        } else {
          setReadyForNextStage(false);
        }
      })
      .catch(err => console.error('Failed to fetch messages:', err));
  }, [chat.id]);

  React.useEffect(() => {
    fetchMessages();
  }, [fetchMessages, subStage]);

  const scrollToBottom = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [chatMessages, subStage]);

  const handleSend = async (messageText?: string) => {
    const text = messageText ?? inputValue;
    if (!text.trim()) return;

    if (!messageText) {
      setInputValue('');
    }

    try {
      await fetch('/api/chats/chatMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat.id,
          project_id: chat.project_id,
          stage: 'final_assessment',
          role: 'user',
          message: text,
        }),
      });

      fetchMessages();

      await fetch('/api/chats/continueFinalAssessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id }),
      });

      scrollToBottom();
    } catch (err) {
      console.error('Send message error:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const finalMessages = chatMessages.filter(m => m.stage === 'final_assessment');
  const showPlaceholder = finalMessages.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-4" ref={chatAreaRef}>
          {showPlaceholder ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground text-center">
                Waiting for questions...
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {finalMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] px-4 py-2 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                    {!viewOnly && msg.role === 'system' && msg.options && msg.options.length > 0 && (
                      <div className="flex flex-col gap-1 mt-2">
                        {msg.options.map((opt, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSend(opt.option)}
                            className="text-xs justify-start h-auto py-1.5 px-2 w-full whitespace-normal text-left"
                          >
                            {opt.recommended ? '★ ' : '  '}{opt.option}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {!viewOnly && subStage === 'system' && <ThinkingBubble chatId={chat.id} />}

              {!viewOnly && readyForNextStage && (
                <div className="flex justify-center mt-4">
                  <Button
                    onClick={async () => {
                      setTransitioning(true);
                      try {
                        await fetch('/api/chats/generatePlan', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ chatId: chat.id }),
                        });
                      } catch (err) {
                        console.error('Failed to generate plan:', err);
                        setTransitioning(false);
                      }
                    }}
                    disabled={transitioning || subStage === 'system'}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {transitioning ? 'Starting...' : 'Generate plan'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!viewOnly && (
        <div className={`h-[140px] border-t border-border px-4 py-3 ${subStage === 'system' ? 'bg-muted/50' : ''}`}>
          <div className="flex justify-between items-center h-full w-full gap-2">
            <div className="flex-1 mx-2 h-full">
              <textarea
                rows={5}
                disabled={subStage === 'system'}
                className="w-full h-full rounded-md border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Type your answer..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            <Button
              variant="default"
              size="icon"
              onClick={() => handleSend()}
              title="Send message"
              disabled={subStage === 'system'}
              className="shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}