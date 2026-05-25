
import * as React from 'react';
import { Play, Square, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ActionBarProps {
  projectId: number;
  liveStatus: 'running' | 'stopped';
  hasRunningJobs: boolean;
  maxParallelJobs: number;
  onStatusChange: (status: 'running' | 'stopped' | 'paused') => void;
  onMaxParallelChange: (value: number) => void;
}

export function ActionBar({ projectId, liveStatus, hasRunningJobs, maxParallelJobs, onStatusChange, onMaxParallelChange }: ActionBarProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = React.useState(false);

  const dotColor = liveStatus === 'running'
    ? (hasRunningJobs ? 'bg-green-400' : 'bg-amber-400 animate-pulse')
    : 'bg-red-500';
  const label = liveStatus === 'running'
    ? (hasRunningJobs ? 'Running' : 'Pending')
    : 'Stopped';

  async function handleStart() {
    setIsLoading(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/start`, { method: 'POST' });
      if (res.ok) {
        onStatusChange('running');
      } else {
        const data = (await res.json()) as { error?: string; log?: string };
        setStartError(data.error ?? `Start failed (${res.status})`);
        if (data.log) console.error('Orchestrator log:\n', data.log);
      }
    } catch (e) {
      setStartError(String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function handleStopClick() {
    if (hasRunningJobs) {
      setStopDialogOpen(true);
    } else {
      void executeStop(false);
    }
  }

  async function executeStop(checkpoint: boolean) {
    setStopDialogOpen(false);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint }),
      });
      if (res.ok) onStatusChange('stopped');
    } finally {
      setIsLoading(false);
    }
  }

  function updateMaxParallel(value: number) {
    const clamped = Math.max(1, value);
    onMaxParallelChange(clamped);
    fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_parallel_jobs: clamped }),
    }).catch(() => {});
  }

  return (
    <>
      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop orchestrator</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            There are jobs currently running. Do you want to save the work in progress before stopping?
            The agent will commit and push all current changes to the feature branch.
          </p>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => void executeStop(false)} disabled={isLoading}>
              Stop now
            </Button>
            <Button variant="default" onClick={() => void executeStop(true)} disabled={isLoading}>
              Stop &amp; Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', dotColor)} />
          <span className={cn(
            'text-sm font-medium',
            liveStatus === 'running'
              ? (hasRunningJobs ? 'text-green-400' : 'text-amber-400')
              : 'text-red-400'
          )}>
            {label}
          </span>
        </div>
        {liveStatus === 'running' ? (
          <Button size="sm" variant="destructive" onClick={handleStopClick} disabled={isLoading}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleStart} disabled={isLoading}>
            <Play className="h-3.5 w-3.5" />
            Start
          </Button>
        )}
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Max Parallel</Label>
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateMaxParallel(maxParallelJobs - 1)}>
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            className="h-7 w-14 text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={maxParallelJobs}
            onChange={(e) => updateMaxParallel(parseInt(e.target.value) || 1)}
            min={1}
          />
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateMaxParallel(maxParallelJobs + 1)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        {startError && (
          <div className="w-full text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            {startError}
            <button className="ml-2 underline" onClick={() => setStartError(null)}>dismiss</button>
          </div>
        )}
      </div>
    </>
  );
}
