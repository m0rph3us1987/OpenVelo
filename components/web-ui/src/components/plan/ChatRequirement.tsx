import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit, Send, Download } from 'lucide-react';

interface ChatRequirementProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatRequirement({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatRequirementProps) {
  const { subStage: wsSubStage, progress } = useStageWebSocket({ chatId: chat.id, stage: 'requirement', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'requirement') : wsSubStage;

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      '': 'Requirement',
      'outline': 'Generating outline...',
      'sections': 'Generating sections...',
      'generate': 'Generating requirement...',
      'requirement': 'Requirement',
      'error': 'Error',
    };
    let subtitle = titleMap[subStage] ?? 'Requirement';

    if (progress) {
      subtitle = progress;
    }

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: subStage === 'outline' || subStage === 'sections' || subStage === 'generate',
    });
  }, [chat.id, subStage, progress, chat.name, onHeaderInfo]);

  if (subStage === 'outline' || subStage === 'sections' || subStage === 'generate') {
    return <TextLog key={`${chat.id}-${subStage}`} chatId={chat.id} clearKey={`${chat.id}-${subStage}`} />;
  }

  if (subStage === 'error') {
    const handleRetry = async () => {
      await fetch(`/api/chats/${chat.id}/requirement/retry`, { method: 'POST' });
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <span>Error generating requirement</span>
        <Button onClick={handleRetry} variant="outline">Retry</Button>
      </div>
    );
  }

  return <RequirementView chat={chat} viewOnly={viewOnly} />;
}

function RequirementView({ chat, viewOnly }: { chat: ChatSession; viewOnly?: boolean }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    fetchRequirement();
  }, [chat.id]);

  const fetchRequirement = async () => {
    try {
      const requirementRes = await fetch(`/api/chats/requirementFile?chatId=${chat.id}`);
      if (requirementRes.ok) {
        const text = await requirementRes.text();
        setContent(text);
      }
    } catch (err) {
      console.error('Failed to fetch requirement:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/chats/saveRequirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id, content }),
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save requirement:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePlan = async () => {
    console.log('[requirement] Generate plan called');
    try {
      await fetch('/api/chats/generatePlan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id }),
      });
    } catch (err) {
      console.error('Failed to generate plan:', err);
    }
  };

  const handleGenerateQuickStory = async () => {
    console.log('[requirement] Generate quick story called');
    try {
      await fetch('/api/chats/generateQuickStory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id }),
      });
    } catch (err) {
      console.error('Failed to generate quick story:', err);
    }
  };

  const isQuickMode = chat.mode === 'quick';
  const handleGenerate = isQuickMode ? handleGenerateQuickStory : handleGeneratePlan;

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REQUIREMENT.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {viewOnly ? (
        <div className="flex justify-end gap-2 p-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={loading || !content}
          >
            <Download className="h-4 w-4 mr-1" />
            Download requirement
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2 p-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={isEditing ? handleSave : () => setIsEditing(true)}
            disabled={saving}
          >
            {saving ? (
              'Saving...'
            ) : isEditing ? (
              <>
                <Send className="h-4 w-4 mr-1" />
                Save
              </>
            ) : (
              <>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </>
            )}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerate}
          >
            {isQuickMode ? 'Generate user story' : 'Generate plan'}
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {!viewOnly && isEditing ? (
          <textarea
            ref={textareaRef}
            className="w-full h-full min-h-[500px] p-4 border border-input rounded-md bg-background font-mono text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {!viewOnly && (
        <div className="flex justify-center p-4 border-t border-border">
          <Button
            variant="default"
            onClick={handleGenerate}
          >
            {isQuickMode ? 'Generate user story' : 'Generate plan'}
          </Button>
        </div>
      )}
    </div>
  );
}