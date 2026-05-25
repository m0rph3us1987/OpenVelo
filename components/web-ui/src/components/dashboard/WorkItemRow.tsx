import * as React from 'react';
import { ChevronRight, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StateBadge } from './StateBadge';
import { DependencyBadge } from './DependencyBadge';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';

interface WorkItemRowProps {
  job: Job;
  maxRetries: number;
  dockerImage?: string;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onEdit?: () => void;
  onOpenDetails: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, job: Job) => void;
}

export function WorkItemRow({ job, maxRetries, dockerImage, selected = false, onSelectedChange, onEdit, onOpenDetails, draggable, onDragStart }: WorkItemRowProps) {
  const isRunning = job.status === 'RUNNING';

  async function handleReset(e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/projects/${job.project_id}/jobs/${job.id}/reset`, { method: 'POST' });
  }

  function handleRowClick() {
    onOpenDetails();
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleRowClick();
        }}
        draggable={draggable}
        onDragStart={(e) => onDragStart?.(e, job)}
        className={cn(
          "w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors cursor-pointer",
          draggable && "cursor-grab active:cursor-grabbing"
        )}
      >
        {onSelectedChange && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectedChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 h-4 w-4 rounded border-border accent-primary cursor-pointer"
          />
        )}
        <span className="text-muted-foreground shrink-0">
          {isRunning ? (
            <span className="w-4 h-4 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            </span>
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <span className="text-xs text-muted-foreground font-mono shrink-0">#{job.id}</span>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-sm text-foreground truncate">
            {job.title || 'Untitled'}
            {isRunning && (
              <span className="ml-2 text-xs text-muted-foreground font-mono">
                ({(job.retry_count ?? 0) + 1} / {maxRetries})
              </span>
            )}
          </span>
          <DependencyBadge dependsOn={job.depends_on} />
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <StateBadge status={job.status} />
          {isRunning && job.stage && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary capitalize">
              {job.stage}
            </span>
          )}
          {job.status === 'PENDING' && onEdit && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit job">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {(job.status === 'FAILED' || job.status === 'COMPLETED') && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset} title="Rerun job">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}