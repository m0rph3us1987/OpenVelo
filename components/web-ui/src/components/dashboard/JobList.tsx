import * as React from 'react';
import { Plus, Play, Square, Minus } from 'lucide-react';
import { WorkItemRow } from './WorkItemRow';
import { AddJobDialog } from './AddJobDialog';
import { JobDetailModal } from './JobDetailModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn, parseSqliteDate } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Job } from '@/lib/types';
import { useToast } from '@/context/ToastContext';

interface JobListProps {
  jobs: Job[];
  projectId: number;
  maxRetries: number;
  dockerImage?: string;
  liveStatus: 'running' | 'stopped';
  maxParallelJobs: number;
  hasRunningJobs: boolean;
  onJobCreated?: () => void;
  onStatusChange: (status: 'running' | 'stopped' | 'paused') => void;
  onMaxParallelChange: (value: number) => void;
}

type TargetStatus = 'PENDING' | 'COMPLETED';

interface ColumnProps {
  title: string;
  jobs: Job[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete?: (jobIds: number[]) => void;
  onEdit?: (job: Job) => void;
  maxRetries: number;
  dockerImage?: string;
  isPendingColumn?: boolean;
  onAddJob?: () => void;
  onOpenDetails: (jobId: number) => void;
  acceptsDrop?: boolean;
  onDropJob?: (jobIds: number[]) => void;
}

function Column({
  title,
  jobs,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onEdit,
  maxRetries,
  dockerImage,
  isPendingColumn,
  onAddJob,
  onOpenDetails,
  acceptsDrop,
  onDropJob,
}: ColumnProps) {
  const selectedCount = jobs.filter((j) => selectedIds.has(j.id)).length;
  const [isDragOver, setIsDragOver] = React.useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (acceptsDrop) {
      e.preventDefault();
      setIsDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  };
  
  const handleDragLeave = () => {
    setIsDragOver(false);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
    if (!acceptsDrop || !onDropJob) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && data.ids && Array.isArray(data.ids)) {
        onDropJob(data.ids);
      }
    } catch (err) {}
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, job: Job) => {
    const idsToMove = selectedIds.has(job.id) ? Array.from(selectedIds) : [job.id];
    e.dataTransfer.setData('application/json', JSON.stringify({ ids: idsToMove }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div 
      className={cn(
        "flex flex-col w-[33.333333%] min-h-0 border-r border-border last:border-r-0 transition-colors",
        isDragOver && "bg-accent/20 ring-2 ring-primary ring-inset"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0 min-h-[48px]">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {jobs.length}
          </span>
          {isPendingColumn && onAddJob && (
            <Button size="sm" onClick={onAddJob} className="h-6 px-1 text-xs">
              <Plus className="h-3 w-3" />
              Add Job
            </Button>
          )}
        </div>
        {jobs.length > 0 && (
          <div className="flex items-center gap-1">
            {selectedCount === 0 ? (
              <Button size="sm" onClick={onSelectAll} className="h-6 px-1 text-xs">
                Select all
              </Button>
            ) : (
              <React.Fragment>
                <Button size="sm" onClick={onDeselectAll} className="h-6 px-1 text-xs">
                  Deselect all
                </Button>
                {onDelete && (
                  <Button size="sm" onClick={() => onDelete(jobs.filter((j) => selectedIds.has(j.id)).map((j) => j.id))} className="h-6 px-1 text-xs">
                    Delete
                  </Button>
                )}
              </React.Fragment>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {jobs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No {title.toLowerCase()} jobs
          </div>
        ) : (
          <div className="py-1">
            {jobs.map((job) => {
              const isDraggable = job.status !== 'RUNNING';
              return (
                <WorkItemRow
                  key={job.id}
                  job={job}
                  maxRetries={maxRetries}
                  dockerImage={dockerImage}
                  selected={selectedIds.has(job.id)}
                  onSelectedChange={(s) => onToggleSelect(job.id, s)}
                  onEdit={onEdit ? () => onEdit(job) : undefined}
                  onOpenDetails={() => onOpenDetails(job.id)}
                  draggable={isDraggable}
                  onDragStart={handleDragStart}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function JobList({ jobs, projectId, maxRetries, dockerImage, liveStatus, maxParallelJobs, hasRunningJobs, onJobCreated, onStatusChange, onMaxParallelChange }: JobListProps) {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [isChanging, setIsChanging] = React.useState(false);
  const [addJobOpen, setAddJobOpen] = React.useState(false);
  const [editJob, setEditJob] = React.useState<Job | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleteJobIds, setDeleteJobIds] = React.useState<number[]>([]);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [startError, setStartError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [activeJobId, setActiveJobId] = React.useState<number | null>(null);

  const hasRunning = jobs.some((j) => j.status === 'RUNNING');

  React.useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const totalRuntimeSeconds = jobs.reduce((acc, job) => {
    if (job.status === 'RUNNING' && job.started_at) {
      const d = parseSqliteDate(job.started_at);
      if (d) {
        return acc + Math.floor((now - d.getTime()) / 1000);
      }
    }
    return acc + (job.runtime || 0);
  }, 0);

  const formatRuntime = (totalSecs: number): string => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

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

  function handleStop() {
    fetch(`/api/projects/${projectId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint: false }),
    }).then((res) => {
      if (res.ok) onStatusChange('stopped');
    }).catch(() => {});
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

  function toggleSelected(id: number, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) { next.add(id); } else { next.delete(id); }
      return next;
    });
  }

  function openDeleteDialog(jobIds: number[]) {
    setDeleteJobIds(jobIds);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await fetch(`/api/projects/${projectId}/jobs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: deleteJobIds }),
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        deleteJobIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteDialogOpen(false);
      onJobCreated?.();
    } finally {
      setIsDeleting(false);
    }
  }

  async function updateJobStatus(jobIds: number[], status: TargetStatus) {
    setIsChanging(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs/set-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        showToast(data.error ?? `Failed to update job status (${res.status})`, 'error');
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        jobIds.forEach((id) => next.delete(id));
        return next;
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update job status', 'error');
    } finally {
      setIsChanging(false);
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Jobs</h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setAddJobOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Job
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <p className="text-3xl font-bold text-muted-foreground mb-8">No jobs yet</p>
          <Button size="lg" onClick={() => setAddJobOpen(true)} className="min-w-[140px]">
            Add a job
          </Button>
        </div>

        <AddJobDialog
          open={addJobOpen || !!editJob}
          onOpenChange={(open) => { setAddJobOpen(open); if (!open) setEditJob(undefined); }}
          projectId={projectId}
          jobs={jobs}
          onCreated={() => onJobCreated?.()}
          editJob={editJob}
        />
      </div>
    );
  }

  const byDate = (a: Job, b: Job) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();

  const pending = jobs.filter((j) => j.status === 'PENDING');
  const failed = jobs.filter((j) => j.status === 'FAILED').sort(byDate);
  const running = jobs.filter((j) => j.status === 'RUNNING').sort(byDate);
  const stopped = jobs.filter((j) => j.status === 'STOPPED').sort(byDate);
  const completed = jobs.filter((j) => j.status === 'COMPLETED').sort(byDate);

  const runningColumnJobs = [...failed, ...running, ...stopped];

  const activeJob = jobs.find((j) => j.id === activeJobId);

  const total = jobs.length || 1;
  const completedPct = Math.round((completed.length / total) * 100);
  const runningPct = Math.round((running.length / total) * 100);
  const totalPct = completedPct + runningPct;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border border-border rounded-md overflow-hidden mb-2">
        <div className="flex-[2] border-r border-border">
          <div className="px-3 py-1.5 border-b border-border bg-muted/30">
            <span className="text-xm font-semibold">Stats</span>
          </div>
          <div className="p-3 flex flex-col gap-3">
            <div className="relative pt-5">
              <div className="absolute top-0 h-5" style={{ left: `${completedPct}%` }}>
                <span className="text-sm text-muted-foreground -translate-x-1/2 min-w-[1px]">{completedPct}%</span>
              </div>
              <div className="absolute top-0 h-5" style={{ left: `${totalPct}%` }}>
                <span className="text-sm font-medium -translate-x-1/2 min-w-[1px]">{totalPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${completedPct}%` }}
                />
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${runningPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground mt-1">Progress</span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-yellow-500">Pending</span>
                <span className="text-xs font-medium text-yellow-500">{pending.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-blue-500">Running</span>
                <span className="text-xs font-medium text-blue-500">{running.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-green-500">Completed</span>
                <span className="text-xs font-medium text-green-500">{completed.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-red-500">Failed</span>
                <span className="text-xs font-medium text-red-500">{failed.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">Stopped</span>
                <span className="text-xs font-medium text-slate-400">{stopped.length}</span>
              </div>
            </div>

            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">Runtime of all containers</span>
              <span className="text-xs font-medium text-muted-foreground">{formatRuntime(totalRuntimeSeconds)}</span>
            </div>
          </div>
        </div>
        <div className="flex-1">
          <div className="px-3 py-1.5 border-b border-border bg-muted/30">
            <span className="text-xm font-semibold">Orchestrator</span>
          </div>
          <div className="p-3 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 mb-1">
              <div className={cn('w-2 h-2 rounded-full', dotColor)} />
              <span className={cn(
                'text-xs font-medium',
                liveStatus === 'running'
                  ? (hasRunningJobs ? 'text-green-400' : 'text-amber-400')
                  : 'text-red-400'
              )}>
                {label}
              </span>
            </div>
            {liveStatus === 'running' ? (
              <Button size="sm" variant="destructive" onClick={handleStop} disabled={isLoading} className="w-full">
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white w-full" onClick={handleStart} disabled={isLoading}>
                <Play className="h-3.5 w-3.5" />
                Start
              </Button>
            )}
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">Max parallel agents</span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateMaxParallel(maxParallelJobs - 1)}>
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  className="h-6 w-12 text-center text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={maxParallelJobs}
                  onChange={(e) => updateMaxParallel(parseInt(e.target.value) || 1)}
                  min={1}
                />
                <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateMaxParallel(maxParallelJobs + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 border border-border rounded-md overflow-hidden h-full">
        <div className="flex h-full">
          <Column
            title="Pending"
            jobs={pending}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
            onSelectAll={() => setSelectedIds((prev) => { const next = new Set(prev); pending.forEach((j) => next.add(j.id)); return next; })}
            onDeselectAll={() => setSelectedIds((prev) => { const next = new Set(prev); pending.forEach((j) => next.delete(j.id)); return next; })}
            onDelete={(ids) => openDeleteDialog(ids)}
            onEdit={(job) => setEditJob(job)}
            maxRetries={maxRetries}
            dockerImage={dockerImage}
            isPendingColumn
            onAddJob={() => setAddJobOpen(true)}
            onOpenDetails={setActiveJobId}
            acceptsDrop={true}
            onDropJob={(ids) => updateJobStatus(ids, 'PENDING')}
          />

          <Column
            title="Running"
            jobs={runningColumnJobs}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
            onSelectAll={() => setSelectedIds((prev) => { const next = new Set(prev); runningColumnJobs.forEach((j) => next.add(j.id)); return next; })}
            onDeselectAll={() => setSelectedIds((prev) => { const next = new Set(prev); runningColumnJobs.forEach((j) => next.delete(j.id)); return next; })}
            maxRetries={maxRetries}
            dockerImage={dockerImage}
            onOpenDetails={setActiveJobId}
            acceptsDrop={false}
          />

          <Column
            title="Completed"
            jobs={completed}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
            onSelectAll={() => setSelectedIds((prev) => { const next = new Set(prev); completed.forEach((j) => next.add(j.id)); return next; })}
            onDeselectAll={() => setSelectedIds((prev) => { const next = new Set(prev); completed.forEach((j) => next.delete(j.id)); return next; })}
            onDelete={(ids) => openDeleteDialog(ids)}
            maxRetries={maxRetries}
            dockerImage={dockerImage}
            onOpenDetails={setActiveJobId}
            acceptsDrop={true}
            onDropJob={(ids) => updateJobStatus(ids, 'COMPLETED')}
          />
        </div>
      </div>

      <AddJobDialog
        open={addJobOpen || !!editJob}
        onOpenChange={(open) => { setAddJobOpen(open); if (!open) setEditJob(undefined); }}
        projectId={projectId}
        jobs={jobs}
        onCreated={() => onJobCreated?.()}
        editJob={editJob}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              Delete {deleteJobIds.length} job{deleteJobIds.length !== 1 ? 's' : ''}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeJob && (
        <JobDetailModal
          job={activeJob}
          dockerImage={dockerImage}
          maxRetries={maxRetries}
          onClose={() => setActiveJobId(null)}
          onEdit={activeJob.status === 'PENDING' ? () => setEditJob(activeJob) : undefined}
        />
      )}
    </div>
  );
}