import * as React from 'react';
import { X, Check, RotateCcw, Trash2, Pencil, Terminal, Cpu, GitBranch, HelpCircle, Play, Square } from 'lucide-react';
import { LogViewer } from './LogViewer';
import { StateBadge } from './StateBadge';
import { parseSqliteDate } from '@/lib/utils';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import { Button } from '@/components/ui/button';
import DOMPurify from 'dompurify';
import type { Job } from '@/lib/types';
import { useToast } from '@/context/ToastContext';

interface JobDetailModalProps {
  job: Job;
  dockerImage?: string;
  maxRetries: number;
  onClose: () => void;
  onEdit?: () => void;
}

function elapsed(dateStr: string, _now?: number): string {
  const d = parseSqliteDate(dateStr);
  if (!d) return '00:00:00';
  const diffMs = (_now ?? Date.now()) - d.getTime();
  if (diffMs < 0) return '00:00:00';
  const totalSecs = Math.floor(diffMs / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const PIPELINE_STAGES = [
  { key: 'setup', label: 'Setup' },
  { key: 'blueprinting', label: 'Blueprint' },
  { key: 'implementing', label: 'Implementing' },
  { key: 'testing', label: 'Build & Test' },
  { key: 'reviewing', label: 'Review' },
  { key: 'documenting', label: 'Documentation' },
  { key: 'pushing', label: 'Push' },
] as const;

function stageIndex(stage: string | null | undefined): number {
  if (!stage) return -1;
  return PIPELINE_STAGES.findIndex((s) => s.key === stage);
}

function PipelineTimeline({
  status,
  stage,
  agentAttempt,
  agentMaxRetries,
}: {
  status: string;
  stage: string | null | undefined;
  agentAttempt?: number | null;
  agentMaxRetries?: number | null;
}) {
  const activeIdx = stageIndex(stage);

  return (
    <div className="p-4 border border-border bg-card/40 rounded-xl">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Pipeline Execution Stages
      </p>
      <div className="flex items-center gap-0">
        {PIPELINE_STAGES.map((s, idx) => {
          let isComplete = false;
          let isActive = false;

          if (status === 'COMPLETED') {
            isComplete = true;
          } else if (status === 'PENDING') {
            isComplete = false;
            isActive = false;
          } else {
            isComplete = idx < activeIdx;
            isActive = idx === activeIdx && status !== 'STOPPED';
          }

          return (
            <React.Fragment key={s.key}>
              {/* Stage node */}
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  className={[
                    'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold border-2 transition-colors duration-200',
                    isComplete
                      ? 'bg-primary border-primary text-primary-foreground'
                      : isActive
                        ? 'bg-primary/20 border-primary text-primary animate-pulse'
                        : 'bg-muted border-border text-muted-foreground',
                  ].join(' ')}
                >
                  {isComplete ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                <span
                  className={[
                    'text-[10px] text-center leading-tight max-w-[65px]',
                    isComplete || isActive ? 'text-foreground font-medium' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {s.label}
                </span>
                {isActive && agentAttempt != null && agentMaxRetries != null && (
                  <span className="text-[9px] text-muted-foreground">
                    ({agentAttempt}/{agentMaxRetries})
                  </span>
                )}
              </div>

              {/* Connector line between stages */}
              {idx < PIPELINE_STAGES.length - 1 && (
                <div
                  className={[
                    'h-0.5 flex-1 mx-1 mb-5 transition-colors duration-300',
                    status === 'COMPLETED'
                      ? 'bg-primary'
                      : status === 'PENDING'
                        ? 'bg-border'
                        : idx < activeIdx
                          ? 'bg-primary'
                          : 'bg-border',
                  ].join(' ')}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function JobDetailModal({ job, dockerImage, maxRetries, onClose, onEdit }: JobDetailModalProps) {
  const { showToast } = useToast();
  const [now, setNow] = React.useState(Date.now());
  const [containerLogs, setContainerLogs] = React.useState<string | null>(null);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [isActionPending, setIsActionPending] = React.useState(false);

  const isRunning = job.status === 'RUNNING';
  const showContainerLogs = (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'STOPPED') && !!job.container_id;

  // Websocket connection for live logs (only if running)
  const { logs: liveLogs, clearLogs } = useJobWebSocket({
    jobId: job.id,
    enabled: isRunning,
  });

  React.useEffect(() => {
    if (isRunning) {
      clearLogs();
    }
  }, [isRunning, clearLogs]);

  // Live elapsed runtime ticker
  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Fetch static container logs for completed/failed jobs
  React.useEffect(() => {
    if (!showContainerLogs) {
      setContainerLogs(null);
      return;
    }
    setLogsLoading(true);
    fetch(`/api/projects/${job.project_id}/jobs/${job.id}/container-logs`)
      .then((r) => r.json())
      .then((data: { logs: string }) => setContainerLogs(data.logs))
      .catch(() => setContainerLogs('No logs available'))
      .finally(() => setLogsLoading(false));
  }, [showContainerLogs, job.project_id, job.id]);

  // Key actions
  async function handleReset() {
    setIsActionPending(true);
    try {
      const res = await fetch(`/api/projects/${job.project_id}/jobs/${job.id}/reset`, { method: 'POST' });
      if (res.ok) {
        showToast('Job reset successfully', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Reset failed', 'error');
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this job? This action cannot be undone.')) return;
    setIsActionPending(true);
    try {
      const res = await fetch(`/api/projects/${job.project_id}/jobs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [job.id] }),
      });
      if (res.ok) {
        showToast('Job deleted successfully', 'success');
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Delete failed', 'error');
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleCancel() {
    setIsActionPending(true);
    try {
      const res = await fetch(`/api/projects/${job.project_id}/jobs/${job.id}/stop`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast('Job stopped successfully', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Stop failed', 'error');
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setIsActionPending(false);
    }
  }

  // Handle ESC close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Glow classes based on job status
  const glowStyles = {
    PENDING: 'shadow-[0_0_50px_rgba(245,158,11,0.15)] border-amber-500/20',
    RUNNING: 'shadow-[0_0_50px_rgba(59,130,246,0.15)] border-blue-500/20',
    COMPLETED: 'shadow-[0_0_50px_rgba(16,185,129,0.15)] border-green-500/20',
    FAILED: 'shadow-[0_0_50px_rgba(239,68,68,0.15)] border-red-500/20',
    STOPPED: 'shadow-[0_0_50px_rgba(100,116,139,0.15)] border-slate-500/20',
  }[job.status] ?? 'shadow-2xl border-border';

  const accentBarStyles = {
    PENDING: 'bg-amber-500',
    RUNNING: 'bg-blue-500',
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    STOPPED: 'bg-slate-500',
  }[job.status] ?? 'bg-border';

  const hasDetails = !!(job.description || job.acceptance_criteria);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Job details cockpit"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />

      {/* 16:9 Modal Panel */}
      <div className={`relative w-[90vw] max-w-[1200px] aspect-[16/9] max-h-[85vh] bg-card/95 border rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ${glowStyles}`}>
        {/* Status Colored Top Accent Bar */}
        <div className={`h-[4px] w-full shrink-0 ${accentBarStyles}`} />

        {/* Header section (10% height equivalent) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-muted/20">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground font-semibold px-2 py-0.5 rounded bg-muted/80">
                #{job.id}
              </span>
              <h2 className="text-base font-semibold text-foreground leading-snug truncate">
                {job.title || 'Untitled Job'}
              </h2>
              <StateBadge status={job.status} />
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {isRunning ? (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                  Running for: <span className="font-mono text-foreground font-medium">{elapsed(job.started_at ?? job.updated_at, now)}</span>
                </span>
              ) : job.status === 'COMPLETED' ? (
                <span>Completed: <span className="text-foreground">{new Date(job.updated_at).toLocaleString()}</span></span>
              ) : job.status === 'FAILED' ? (
                <span className="text-red-400">Failed at: <span className="text-foreground">{new Date(job.updated_at).toLocaleString()}</span></span>
              ) : job.status === 'STOPPED' ? (
                <span className="text-slate-400">Stopped at: <span className="text-foreground">{new Date(job.updated_at).toLocaleString()}</span></span>
              ) : (
                <span>Created: <span className="text-foreground">{new Date(job.created_at).toLocaleString()}</span></span>
              )}
              {job.retry_count != null && (
                <span>Attempt: <span className="text-foreground">{job.retry_count + 1} / {maxRetries}</span></span>
              )}
              {job.container_id && (
                <span>Container: <span className="text-foreground font-mono select-all" title={job.container_id}>{job.container_id.substring(0, 12)}</span></span>
              )}
              {(isRunning || !!job.container_id) && (
                <span>Image: <span className="text-foreground font-mono" title={dockerImage ?? 'node:18-alpine'}>{dockerImage ?? 'node:18-alpine'}</span></span>
              )}
              {job.status !== 'RUNNING' && job.status !== 'PENDING' && (
                <span>Runtime: <span className="text-foreground font-mono">
                  {(() => {
                    const secs = job.runtime || 0;
                    const hrs = Math.floor(secs / 3600);
                    const mins = Math.floor((secs % 3600) / 60);
                    const s = secs % 60;
                    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                  })()}
                </span></span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 ml-4">
            {job.status !== 'COMPLETED' && job.status !== 'PENDING' && (
              <>
                {job.status === 'RUNNING' ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancel}
                    disabled={isActionPending}
                    className="flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop
                  </Button>
                ) : job.status === 'STOPPED' ? (
                  <Button
                    className="bg-green-600 hover:bg-green-700 text-white font-medium flex items-center gap-1.5"
                    size="sm"
                    onClick={handleReset}
                    disabled={isActionPending}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Start
                  </Button>
                ) : job.status === 'FAILED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={isActionPending}
                    className="flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry
                  </Button>
                ) : null}
              </>
            )}

            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 hover:bg-muted/80 rounded-lg"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Split Container (Remaining 90% height) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column (40% width) - Details & Description */}
          <div className="w-[40%] flex flex-col p-6 border-r border-border min-h-0 bg-card/25 overflow-hidden">
            <div className="flex-1 space-y-5">
              {/* User Story Description & AC */}
              {hasDetails ? (
                <div className="space-y-4">
                  {job.description && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Job Description
                      </p>
                      <div
                        className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap p-3 bg-muted/20 border border-border rounded-xl max-h-[240px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(job.description) }}
                      />
                    </div>
                  )}
                  {job.acceptance_criteria && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Acceptance Criteria
                      </p>
                      <div
                        className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap p-3 bg-muted/20 border border-border rounded-xl max-h-[240px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(job.acceptance_criteria) }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                  <HelpCircle className="w-8 h-8 opacity-40 mb-2" />
                  <span className="text-xs">No specifications or description provided.</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column (60% width) - Pipeline Map & Live Console Logs */}
          <div className="w-[60%] flex flex-col p-6 min-h-0 overflow-hidden">
            {/* Horizontal Timeline at the top */}
            <div className="shrink-0 mb-4">
              <PipelineTimeline
                status={job.status}
                stage={job.stage}
                agentAttempt={job.agent_attempt}
                agentMaxRetries={job.agent_max_retries}
              />
            </div>

            {/* Monospace Developer Terminal Console Box below */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                  Developer Terminal Console Logs
                </span>
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-[10px] text-blue-400 font-medium px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
                    Streaming Live
                  </span>
                )}
              </div>

              {/* Log Container */}
              <div className="flex-1 min-h-0 h-full border border-border rounded-xl overflow-hidden bg-card/50 flex flex-col">
                {isRunning ? (
                  <LogViewer
                    liveLogs={liveLogs}
                    className="flex-1 min-h-0 h-auto"
                  />
                ) : showContainerLogs ? (
                  logsLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10">
                      <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2" />
                      Loading logs from container...
                    </div>
                  ) : containerLogs ? (
                    <LogViewer
                      logs={containerLogs}
                      className="flex-1 min-h-0 h-auto"
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10 italic">
                      Container no longer available (No logs saved).
                    </div>
                  )
                ) : job.status === 'PENDING' ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground font-mono bg-muted/10">
                    <Terminal className="w-8 h-8 opacity-30 mb-2 animate-pulse text-amber-500" />
                    <span className="text-xs font-semibold text-foreground/80 mb-1">Job is Waiting in Queue</span>
                    <span className="text-[11px] max-w-[320px] leading-relaxed">
                      This job is pending execution. Once the orchestrator provisions an active agent worker, logs will stream here live.
                    </span>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10 italic">
                    No logs available for this job state.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
