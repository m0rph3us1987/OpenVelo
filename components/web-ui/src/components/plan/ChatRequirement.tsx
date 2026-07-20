import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { ParallelLogViewer } from './ParallelLogViewer';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit, Send, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/useIsMobile';

interface ChatRequirementProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatRequirement({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatRequirementProps) {
  const { subStage: wsSubStage, progress } = useStageWebSocket({ chatId: chat.id, stage: 'requirement', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'requirement') : wsSubStage;
  const [actionLoading, setActionLoading] = React.useState(false);

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

    let showSpinner = subStage === 'outline' || subStage === 'sections' || subStage === 'generate';
    if (chat.running === 0) {
      subtitle = 'Stopped';
      showSpinner = false;
    }

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner,
    });
  }, [chat.id, subStage, progress, chat.name, onHeaderInfo, chat.running]);

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/chats/${chat.id}/stop`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/chats/${chat.id}/resume`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to resume:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const renderStopResumeOverlay = () => {
    if (viewOnly) return null;
    const isGenerating = subStage === 'outline' || subStage === 'sections' || subStage === 'generate';
    if (!isGenerating && chat.running !== 0) return null;

    return (
      <div className="absolute top-4 right-4 z-50">
        {chat.running === 1 ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={actionLoading}
            className="shadow-md"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleResume}
            disabled={actionLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
          >
            Resume
          </Button>
        )}
      </div>
    );
  };

  if (subStage === 'outline' || subStage === 'generate') {
    return (
      <div className="relative w-full h-full">
        {renderStopResumeOverlay()}
        <TextLog key={`${chat.id}-${subStage}`} chatId={chat.id} clearKey={`${chat.id}-${subStage}`} />
      </div>
    );
  }

  if (subStage === 'sections') {
    return (
      <div className="relative w-full h-full">
        {renderStopResumeOverlay()}
        <ParallelLogViewer chatId={chat.id} type="requirement" />
      </div>
    );
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
  const isMobile = useIsMobile();
  const MobileConfirmDialog = React.lazy(() =>
    import('@/components/ui/mobile-confirm-dialog').then((m) => ({ default: m.MobileConfirmDialog }))
  );
  const [isEditing, setIsEditing] = React.useState(false);
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = React.useState(false);
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

  const handleRegenerateRequirement = () => {
    setShowRegenConfirm(true);
  };

  const confirmRegenerate = async () => {
    setShowRegenConfirm(false);
    try {
      await fetch(`/api/chats/${chat.id}/requirement/regenerate`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to regenerate requirement:', err);
    }
  };

  const handleGenerate = async () => {
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
      <div className="flex justify-end gap-2 p-2 border-b border-border">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleRegenerateRequirement}
        >
          Regenerate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={loading || !content}
        >
          <Download className="h-4 w-4 mr-1" />
          Download requirement
        </Button>
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
          Generate plan
        </Button>
      </div>

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

      {isMobile ? (
        <React.Suspense fallback={null}>
          <MobileConfirmDialog
            open={showRegenConfirm}
            onOpenChange={setShowRegenConfirm}
            title="Regenerate requirement"
            description="Are you sure you want to regenerate the requirement from scratch? This will delete the current requirement and any generated plans."
            confirmLabel="Regenerate"
            variant="destructive"
            onConfirm={confirmRegenerate}
          />
        </React.Suspense>
      ) : (
        <Dialog open={showRegenConfirm} onOpenChange={setShowRegenConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Regenerate requirement</DialogTitle>
              <DialogDescription>
                Are you sure you want to regenerate the requirement from scratch? This will delete the current requirement and any generated plans.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setShowRegenConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmRegenerate}>
                Regenerate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}