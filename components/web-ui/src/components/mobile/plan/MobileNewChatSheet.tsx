import * as React from 'react';
import { ClipboardList, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ChatMode, ChatSession } from '@/lib/types';

interface MobileNewChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onCreated: (chat: ChatSession) => void;
}

const MODE_OPTIONS: {
  mode: ChatMode;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    mode: 'plan',
    label: 'Plan',
    description: 'Full implementation plan with epics, features, and jobs',
    icon: ClipboardList,
  },
  {
    mode: 'requirement',
    label: 'Requirement',
    description: 'Upload a requirement document and generate a plan from it',
    icon: FileText,
  },
];

export function MobileNewChatSheet({ open, onOpenChange, projectId, onCreated }: MobileNewChatSheetProps) {
  const [name, setName] = React.useState('');
  const [selectedMode, setSelectedMode] = React.useState<ChatMode | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [modeError, setModeError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);

  const isValid = name.trim().length > 0 && selectedMode !== null;

  React.useEffect(() => {
    if (!open) {
      setName('');
      setSelectedMode(null);
      setModeError(null);
      setNameError(null);
      setApiError(null);
      setIsCreating(false);
    }
  }, [open]);

  async function handleCreate() {
    setModeError(null);
    setNameError(null);
    setApiError(null);

    if (!selectedMode) {
      setModeError('Please select a planning mode');
      return;
    }
    if (!name.trim()) {
      setNameError('Please enter a chat name');
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch('/api/chatCreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedMode, name: name.trim(), project_id: projectId }),
      });
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'mode must be plan or requirement') {
          setModeError(data.error);
          return;
        }
        throw new Error(data.error || 'Validation failed');
      }
      if (!res.ok) {
        throw new Error('Failed to create chat. Please try again.');
      }
      const chat = (await res.json()) as ChatSession;
      onCreated(chat);
    } catch (e) {
      if (e instanceof Error) {
        setApiError(e.message);
      } else {
        setApiError('Failed to create chat. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0',
          'rounded-t-2xl rounded-b-none border-b-0',
          'w-full max-w-none p-4 pb-safe-bottom',
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom'
        )}
      >
        <DialogTitle className="text-mobile-h2">New chat</DialogTitle>
        <DialogDescription className="sr-only">
          Create a new planning or requirement chat session.
        </DialogDescription>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="mobile-chat-name">Chat name</Label>
            <Input
              id="mobile-chat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter chat name"
              disabled={isCreating}
              onKeyDown={(e) => e.key === 'Enter' && isValid && handleCreate()}
              className="text-base tap-target"
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="flex flex-col gap-3">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => !isCreating && setSelectedMode(option.mode)}
                    disabled={isCreating}
                    aria-pressed={isSelected}
                    className={cn(
                      'tap-target flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary active:bg-primary/15'
                        : 'border-border active:bg-muted',
                      isCreating && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-mobile-body">{option.label}</div>
                      <div
                        className={cn(
                          'text-mobile-caption',
                          isSelected ? 'text-primary/80' : 'text-muted-foreground'
                        )}
                      >
                        {option.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {modeError && <p className="text-sm text-destructive">{modeError}</p>}
          </div>

          {apiError && <p className="text-sm text-destructive">{apiError}</p>}
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
            className="tap-target-lg flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid || isCreating}
            className="tap-target-lg flex-1"
          >
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
