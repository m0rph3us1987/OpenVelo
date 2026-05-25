import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { Button } from '@/components/ui/button';
import { Send, Upload, Trash2 } from 'lucide-react';
import { ThinkingBubble } from './ThinkingBubble';

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

interface ChatCollectingProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

function UploadsPanel({ files, onDelete, viewOnly }: {
  files: string[];
  onDelete: (filename: string) => void;
  viewOnly?: boolean;
}) {
  return (
    <div className="w-72 border-l border-border flex flex-col">
      <div className="p-2 font-bold text-sm text-muted-foreground">
        Uploads
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded">
        {files.length === 0 && (
          <p className="text-xs text-muted-foreground">No files uploaded</p>
        )}
        {files.map((filename) => (
          <div key={filename} className="flex items-center justify-between group">
            <span className="text-sm truncate flex-1">{filename}</span>
            {!viewOnly && (
              <button
                onClick={() => onDelete(filename)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive shrink-0"
                title="Delete file"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatCollecting({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatCollectingProps) {
  const { subStage: wsSubStage } = useStageWebSocket({ chatId: chat.id, stage: 'collecting', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'user') : wsSubStage;
  const [inputValue, setInputValue] = React.useState('');
  const [files, setFiles] = React.useState<string[]>([]);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [readyForNextStage, setReadyForNextStage] = React.useState(false);
  const [transitioning, setTransitioning] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const chatAreaRef = React.useRef<HTMLDivElement>(null);

  const fetchMessages = React.useCallback(() => {
    fetch(`/api/chats/chatMessages?chatId=${chat.id}`)
      .then((res) => res.json())
      .then((data: ChatMessage[]) => {
        setChatMessages(data);
        const latestSystem = [...data].reverse().find(m => m.role === 'system');
        if (latestSystem?.ready_for_next_stage) {
          setReadyForNextStage(true);
        } else {
          setReadyForNextStage(false);
        }
      })
      .catch((err) => console.error('Failed to fetch messages:', err));
  }, [chat.id]);

  React.useEffect(() => {
    onHeaderInfo?.({
      title: `${chat.name} - Collecting idea`,
      showSpinner: false,
    });
  }, [chat.id, chat.name, onHeaderInfo]);

  React.useEffect(() => {
    fetchMessages();
  }, [fetchMessages, subStage]);

  const fetchFiles = React.useCallback(() => {
    fetch(`/api/uploads/chatFiles?chatId=${chat.id}`)
      .then((res) => res.json())
      .then((data) => setFiles(data.files || []))
      .catch((err) => console.error('Failed to fetch files:', err));
  }, [chat.id]);

  React.useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('chatId', String(chat.id));
    formData.append('file', file);

    fetch('/api/uploads/chatUpload', {
      method: 'POST',
      body: formData,
    }).then((res) => {
      if (!res.ok) {
        console.error('File upload failed');
      } else {
        fetchFiles();
      }
    }).catch((err) => {
      console.error('File upload error:', err);
    });

    e.target.value = '';
  };

  const deleteFile = (filename: string) => {
    fetch('/api/uploads/chatFile', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, filename }),
    }).then((res) => {
      if (!res.ok) {
        console.error('Failed to delete file');
      } else {
        fetchFiles();
      }
    }).catch((err) => {
      console.error('Delete file error:', err);
    });
  };

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
          stage: 'collecting',
          role: 'user',
          message: text,
        }),
      });

      fetchMessages();

      await fetch('/api/chats/collectNext', {
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

  const scrollToBottom = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [chatMessages, subStage]);

  const showPlaceholder = chatMessages.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-4" ref={chatAreaRef}>
          {showPlaceholder ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground text-center">
                Start describing your idea below
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {chatMessages.map((msg) => (
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
                        await fetch('/api/chats/startDomainPlanning', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ chatId: chat.id }),
                        });
                      } catch (err) {
                        console.error('Failed to start domain planning:', err);
                        setTransitioning(false);
                      }
                    }}
                    disabled={transitioning || subStage === 'system'}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {transitioning ? 'Starting...' : 'Start domain planning'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <UploadsPanel files={files} onDelete={deleteFile} viewOnly={viewOnly} />
      </div>

      {!viewOnly && (
        <div className={`h-[140px] border-t border-border px-4 py-3 ${subStage === 'system' ? 'bg-muted/50' : ''}`}>
          <div className="flex justify-between items-center h-full w-full gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleUploadClick}
              title="Upload file"
              disabled={subStage === 'system'}
              className="shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex-1 mx-2 h-full">
              <textarea
                rows={5}
                disabled={subStage === 'system'}
                className="w-full h-full rounded-md border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Type your message..."
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