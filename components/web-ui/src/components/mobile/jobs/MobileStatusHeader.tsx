import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, Loader2, Play, Plus, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { useToast } from '@/context/ToastContext';

interface MobileStatusHeaderProps {
  project: Project;
  projectId: number;
  liveStatus: 'running' | 'stopped' | undefined;
  hasRunningJobs: boolean;
  onAddJob: () => void;
  /**
   * Called after a successful start or stop so the parent can re-poll the
   * orchestrator status immediately (the 1s background poll will also pick
   * it up, but this avoids a 0–1s lag where the pill still shows the prior
   * state).
   */
  onAfterAction?: () => Promise<void> | void;
}

export function MobileStatusHeader({
  project,
  projectId,
  liveStatus,
  hasRunningJobs,
  onAddJob,
  onAfterAction,
}: MobileStatusHeaderProps) {
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState<'start' | 'stop' | null>(null);

  const dotColor =
    liveStatus === 'running'
      ? hasRunningJobs
        ? 'bg-green-400'
        : 'bg-amber-400 animate-pulse'
      : 'bg-red-500';
  const label =
    liveStatus === 'running' ? (hasRunningJobs ? 'Running' : 'Pending') : 'Stopped';
  const statusTextColor =
    liveStatus === 'running'
      ? hasRunningJobs
        ? 'text-green-400'
        : 'text-amber-400'
      : 'text-red-400';

  async function handleStart() {
    if (isLoading) return;
    setIsLoading('start');
    try {
      const res = await fetch(`/api/projects/${projectId}/start`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(data.error ?? `Start failed (${res.status})`, 'error');
        return;
      }
      await onAfterAction?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Start failed', 'error');
    } finally {
      setIsLoading(null);
    }
  }

  async function handleStop() {
    if (isLoading) return;
    setIsLoading('stop');
    try {
      const res = await fetch(`/api/projects/${projectId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint: false }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(data.error ?? `Stop failed (${res.status})`, 'error');
        return;
      }
      await onAfterAction?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Stop failed', 'error');
    } finally {
      setIsLoading(null);
    }
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-border bg-card/40">
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-label={open ? 'Collapse orchestrator status' : 'Expand orchestrator status'}
          className="tap-target flex w-full items-center justify-between gap-2 px-4 py-3 text-left active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', dotColor)} aria-hidden="true" />
            <span className="text-mobile-h3 font-semibold truncate text-foreground">
              {project.name}
            </span>
            <span className={cn('text-mobile-body font-semibold shrink-0', statusTextColor)}>
              · {label}
            </span>
          </div>
          <ChevronDown
            className={cn(
              'h-5 w-5 text-muted-foreground transition-transform shrink-0',
              open && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="overflow-hidden">
        <div className="flex flex-col gap-3 px-4 pb-4 pt-1">
          <div className="flex items-center gap-2">
            {liveStatus === 'running' ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleStop}
                disabled={isLoading !== null}
                className="tap-target h-11 flex-1"
              >
                {isLoading === 'stop' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {isLoading === 'stop' ? 'Stopping…' : 'Stop orchestrator'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleStart}
                disabled={isLoading !== null}
                className="tap-target h-11 flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {isLoading === 'start' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isLoading === 'start' ? 'Starting…' : 'Start orchestrator'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onAddJob}
              className="tap-target h-11 flex-1 active:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Add Job
            </Button>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
