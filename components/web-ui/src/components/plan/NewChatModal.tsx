import * as React from 'react';
import { ClipboardList, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ChatMode, ChatSession } from '@/lib/types';

interface NewChatModalProps {
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

export function NewChatModal({ open, onOpenChange, projectId, onCreated }: NewChatModalProps) {
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
      const chat = await res.json();
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Chat</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="chat-name">Chat Name</Label>
            <Input
              id="chat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter chat name"
              disabled={isCreating}
              onKeyDown={(e) => e.key === 'Enter' && isValid && handleCreate()}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-3">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    onClick={() => !isCreating && setSelectedMode(option.mode)}
                    disabled={isCreating}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all flex flex-col gap-2',
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50 hover:bg-muted',
                      isCreating && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      <span className="font-medium text-sm">{option.label}</span>
                    </div>
                    <p className={cn(
                      'text-xs leading-relaxed',
                      isSelected ? 'text-primary/80' : 'text-muted-foreground'
                    )}>
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
            {modeError && <p className="text-sm text-destructive">{modeError}</p>}
          </div>

          {apiError && <p className="text-sm text-destructive">{apiError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid || isCreating}>
            {isCreating ? (
              <>
                <span className="animate-spin mr-2">&#9696;</span>
                Creating...
              </>
            ) : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}