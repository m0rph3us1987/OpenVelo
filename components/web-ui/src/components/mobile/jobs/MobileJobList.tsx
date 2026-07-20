import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DependencyBadge } from '@/components/dashboard/DependencyBadge';
import { StateBadge } from '@/components/dashboard/StateBadge';
import { JobTypeBadge } from '@/components/dashboard/JobTypeBadge';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';

interface MobileJobListProps {
  jobs: Job[];
  isLoading?: boolean;
  onSelect: (jobId: number) => void;
  onAddJob: () => void;
}

export function MobileJobList({ jobs, isLoading, onSelect, onAddJob }: MobileJobListProps) {
  if (isLoading && jobs.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground"
      >
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="text-mobile-caption">Loading jobs…</span>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <p className="text-mobile-h2 font-semibold text-foreground">No jobs yet</p>
        <p className="text-mobile-caption text-muted-foreground">
          Create your first job to start the orchestrator.
        </p>
        <Button
          type="button"
          onClick={onAddJob}
          className="tap-target h-12 w-full max-w-xs"
        >
          <Plus className="h-5 w-5" />
          Add Job
        </Button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 pb-4" aria-label="Job list">
      {jobs.map((job) => (
        <li key={job.id}>
          <MobileJobRow job={job} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

interface MobileJobRowProps {
  job: Job;
  onSelect: (jobId: number) => void;
}

function MobileJobRow({ job, onSelect }: MobileJobRowProps) {
  const isRunning = job.status === 'RUNNING';
  const title = job.title || 'Untitled';

  function handleClick() {
    onSelect(job.id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Open job ${title}`}
      className={cn(
        'tap-target flex w-full min-h-[56px] items-center gap-3 rounded-md border border-border bg-card px-3 py-3 text-left active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full',
          isRunning ? 'bg-blue-400 animate-pulse' : 'bg-muted-foreground/40'
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-mobile-body font-medium text-foreground truncate">
          {title}
        </span>
        <div className="flex items-center gap-2 text-mobile-caption text-muted-foreground">
          <span className="font-mono">#{job.id}</span>
          {job.depends_on && <DependencyBadge dependsOn={job.depends_on} />}
        </div>
      </div>
      <StateBadge status={job.status} />
        <JobTypeBadge type={job.type ?? 'implementation'} />
    </button>
  );
}
