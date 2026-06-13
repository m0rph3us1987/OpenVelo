import * as React from 'react';
import {
  X,
  Check,
  RotateCcw,
  Trash2,
  Pencil,
  Terminal,
  Info,
  Loader2,
  ListChecks,
  Activity,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { LogViewer } from './LogViewer';
import { StateBadge } from './StateBadge';
import { parseSqliteDate, cn } from '@/lib/utils';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import { wsManager, WsKeys } from '@/lib/websocket-manager';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import DOMPurify from 'dompurify';
import type {
  Job,
  JobStatus,
  JobStatusPlanEntry,
  JobStatusUsage,
  WsJobPlanUpdateMessage,
  WsJobUsageUpdateMessage,
  WsJobUpdateMessage,
} from '@/lib/types';
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

function formatNumber(n: number | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
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

function UsagePanel({
  usage,
  isExpanded,
  onExpand,
}: {
  usage: JobStatusUsage | null;
  isExpanded: boolean;
  onExpand: () => void;
}) {
  const hasContext = usage && (usage.used != null || usage.size != null);
  const hasInput = usage?.inputTokens != null;
  const hasOutput = usage?.outputTokens != null;
  const hasCacheRead = (usage?.cachedReadTokens ?? 0) > 0;
  const hasCacheWrite = (usage?.cachedWriteTokens ?? 0) > 0;
  const hasTotal = usage?.totalTokens != null;
  const hasCost = usage?.cost != null;
  const hasAnyTokens = hasInput || hasOutput || hasCacheRead || hasCacheWrite || hasTotal;

  const used = usage?.used ?? 0;
  const size = usage?.size ?? 0;
  const pct = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary';

  return (
    <div
      className={cn(
        "border border-border bg-card/40 rounded-xl transition-all duration-200",
        isExpanded ? "p-4" : "p-3 cursor-pointer hover:bg-card/60"
      )}
      onClick={!isExpanded ? onExpand : undefined}
    >
      <div className="flex items-center justify-between select-none">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          Usage
        </p>
        <div className="flex items-center gap-2">
          {!isExpanded ? (
            <>
              {hasContext && (
                <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </>
          ) : (
            <>
              {hasContext && (
                <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" />
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3">
          {hasContext ? (
            <div className="mb-3">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Context window</span>
                <span className="font-mono text-foreground">
                  {formatNumber(usage?.used)} / {formatNumber(usage?.size)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${barColor} transition-all duration-300`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="mb-3 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Context window</span>
              <span className="font-mono text-muted-foreground">—</span>
            </div>
          )}

          <div className="space-y-1.5 text-xs">
            <Row
              label="Input (incl. cache)"
              hint="Cumulative input context. Includes cache read + write, matching the Kilo CLI's 'Context' display."
              value={hasInput ? formatNumber(usage?.inputTokens) : undefined}
            />
            <Row
              label="Output (incl. reasoning)"
              hint="Cumulative output tokens. Includes reasoning, matching the Kilo CLI's 'Context' display."
              value={hasOutput ? formatNumber(usage?.outputTokens) : undefined}
            />
            {(hasCacheRead || hasCacheWrite) && (
              <>
                <Row
                  label="Cache read"
                  hint="Cumulative cache-read tokens. A subset of 'Input (incl. cache)'."
                  value={hasCacheRead ? formatNumber(usage?.cachedReadTokens) : undefined}
                  muted
                />
                <Row
                  label="Cache write"
                  hint="Cumulative cache-write tokens. A subset of 'Input (incl. cache)'."
                  value={hasCacheWrite ? formatNumber(usage?.cachedWriteTokens) : undefined}
                  muted
                />
              </>
            )}
            <Row
              label="Total"
              hint="Cumulative total. Sum of the four cumulative sub-fields above (cache is double-counted; matches the Kilo CLI's per-turn formula)."
              value={hasTotal ? formatNumber(usage?.totalTokens) : undefined}
            />
          </div>

          {hasCost && usage?.cost && (
            <div className="mt-3 pt-2.5 border-t border-border flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-mono text-foreground">
                {usage.cost.amount.toFixed(4)} {usage.cost.currency}
              </span>
            </div>
          )}

          {!hasContext && !hasAnyTokens && !hasCost && (
            <div className="text-[11px] text-muted-foreground italic">
              No usage reported yet.
            </div>
          )}

          <p className="mt-3 text-[10px] text-muted-foreground/70 leading-relaxed">
            Within a single agent stage, token counts reflect only the final
            assistant message (ACP protocol limitation). Cost is cumulative
            across all assistant messages.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  value,
  muted,
}: {
  label: string;
  hint: string;
  value: string | undefined;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={hint}>
      <span className={muted ? 'text-muted-foreground/80 pl-2' : 'text-muted-foreground'}>
        {label}
      </span>
      <span className={`font-mono ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}



function PlanPanel({
  entries,
  isExpanded,
  onExpand,
}: {
  entries: JobStatusPlanEntry[] | null;
  isExpanded: boolean;
  onExpand: () => void;
}) {
  return (
    <div
      className={cn(
        "border border-border bg-card/40 rounded-xl flex flex-col transition-all duration-200",
        isExpanded ? "p-4 flex-1 min-h-0" : "p-3 cursor-pointer hover:bg-card/60 shrink-0"
      )}
      onClick={!isExpanded ? onExpand : undefined}
    >
      <div className="flex items-center justify-between select-none shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-muted-foreground" />
          Plan
        </p>
        <div className="flex items-center gap-2">
          {entries && entries.length > 0 && isExpanded && (
            <span className="text-[10px] font-mono text-muted-foreground mr-1">
              {entries.filter((e) => e.status === 'completed').length} / {entries.length}
            </span>
          )}
          {!isExpanded ? (
            <>
              {entries && entries.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground mr-1">
                  {entries.filter((e) => e.status === 'completed').length} / {entries.length}
                </span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </>
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 space-y-1.5 mt-3">
          {!entries || entries.length === 0 ? (
            <div className="text-[11px] text-muted-foreground italic">
              No plan reported yet.
            </div>
          ) : (
            entries.map((entry, idx) => {
              const leading =
                entry.status === 'completed' ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                ) : entry.status === 'in_progress' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center text-muted-foreground font-mono text-sm leading-none">
                    —
                  </span>
                );

              return (
                <div
                  key={`${idx}-${entry.content}`}
                  className="flex items-start gap-2 text-xs"
                >
                  <div className="mt-0.5 shrink-0">{leading}</div>
                  <div
                    className={[
                      'flex-1 min-w-0',
                      entry.status === 'completed' ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'text-foreground/90',
                      entry.status === 'in_progress' ? 'font-medium' : '',
                    ].join(' ')}
                  >
                    <p className="whitespace-pre-wrap break-words leading-snug font-mono">
                      {entry.content}
                    </p>
                  </div>

                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function JobInfoModal({
  job,
  open,
  onOpenChange,
}: {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <InfoDialogOverlay />
      <InfoDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            {job.title || 'Untitled Job'}
          </DialogTitle>
          <DialogDescription>
            Job #{job.id} — full description
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto mt-2">
          {job.description ? (
            <div
              className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap p-4 bg-muted/20 border border-border rounded-lg"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(job.description) }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Info className="w-8 h-8 opacity-40 mb-2" />
              <span className="text-sm">No description provided for this job.</span>
            </div>
          )}
        </div>
      </InfoDialogContent>
    </Dialog>
  );
}

const InfoDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[70] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
InfoDialogOverlay.displayName = 'InfoDialogOverlay';

const InfoDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <InfoDialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-[70] grid w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-h-[80vh] flex flex-col',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
InfoDialogContent.displayName = 'InfoDialogContent';

export function JobDetailModal({ job, dockerImage, maxRetries, onClose, onEdit }: JobDetailModalProps) {
  const { showToast } = useToast();
  const [now, setNow] = React.useState(Date.now());
  const [containerLogs, setContainerLogs] = React.useState<string | null>(null);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [isActionPending, setIsActionPending] = React.useState(false);
  const [liveJobState, setLiveJobState] = React.useState<JobStatus | null>(null);
  const [liveUsage, setLiveUsage] = React.useState<JobStatusUsage | null>(null);
  const [livePlan, setLivePlan] = React.useState<JobStatusPlanEntry[] | null>(null);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [expandedPanel, setExpandedPanel] = React.useState<'plan' | 'usage'>('plan');

  const isRunning = job.status === 'RUNNING';
  const showContainerLogs = (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'STOPPED') && !!job.container_id;

  const { logs: liveLogs, clearLogs } = useJobWebSocket({
    jobId: job.id,
    enabled: isRunning,
  });

  React.useEffect(() => {
    if (isRunning) {
      clearLogs();
    }
  }, [isRunning, clearLogs]);

  // Fetch the full AgentStatus on modal open (stage, plan, usage).
  // This happens once; subsequent updates arrive via WS broadcasts.
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${job.project_id}/jobs/${job.id}/agent-status`)
      .then((r) => r.json())
      .then((data: { state: JobStatus | null; plan?: JobStatusPlanEntry[] | null; usage?: JobStatusUsage | null }) => {
        if (cancelled) return;
        if (data.state) setLiveJobState(data.state);
        if (data.usage) setLiveUsage(data.usage);
        if (data.plan) setLivePlan(data.plan);
      })
      .catch(() => { /* offline orchestrator — fall back to DB */ });
    return () => { cancelled = true; };
  }, [job.project_id, job.id]);

  // Subscribe to project WS for live broadcasts
  React.useEffect(() => {
    const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.hostname}:${wsPort}/ws?projectId=${job.project_id}`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'job_update' && msg.jobId === job.id) {
          const update = msg as WsJobUpdateMessage;
          setLiveJobState((prev) => ({
            jobId: job.id,
            startDateTime: update.startDateTime ?? prev?.startDateTime ?? '',
            stage: update.stage ?? prev?.stage ?? '',
            attempt: update.attempt ?? prev?.attempt ?? 1,
            maxAttempts: update.maxAttempts ?? prev?.maxAttempts ?? 1,
            agentAttempt: update.agentAttempt ?? prev?.agentAttempt,
            agentMaxRetries: update.agentMaxRetries ?? prev?.agentMaxRetries,
          }));
        }

        if (msg.type === 'job_usage_update' && msg.jobId === job.id) {
          const u = msg as WsJobUsageUpdateMessage;
          setLiveUsage((prev) => ({
            used: u.used ?? prev?.used,
            size: u.size ?? prev?.size,
            totalTokens: u.totalTokens ?? prev?.totalTokens,
            inputTokens: u.inputTokens ?? prev?.inputTokens,
            outputTokens: u.outputTokens ?? prev?.outputTokens,
            cachedReadTokens: u.cachedReadTokens ?? prev?.cachedReadTokens,
            cachedWriteTokens: u.cachedWriteTokens ?? prev?.cachedWriteTokens,
            cost: u.cost ?? prev?.cost,
          }));
        }

        if (msg.type === 'job_plan_update' && msg.jobId === job.id) {
          const p = msg as WsJobPlanUpdateMessage;
          setLivePlan(p.entries ?? []);
        }
      } catch { /* ignore malformed */ }
    };

    return () => {
      // Synchronously remove this socket from the manager so a subsequent
      // effect run (e.g. React 19 StrictMode dev double-mount) cannot
      // broadcast to a stale socket.
      wsManager.unregister(ws);
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      try { ws.close(); } catch { /* ignore */ }
    };
  }, [job.project_id, job.id]);

  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

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

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const hasDetails = !!job.description;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Job details cockpit"
      >
        <div className="absolute inset-0 bg-black/75" onClick={onClose} />

        <div className={`relative w-[95vw] max-w-[1600px] aspect-[16/10] max-h-[92vh] bg-card/95 border rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ${glowStyles}`}>
          <div className={`h-[4px] w-full shrink-0 ${accentBarStyles}`} />

          {/* Header (unchanged + Info button) */}
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
                <button
                  onClick={() => setInfoOpen(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-muted/80 rounded"
                  aria-label="Show job description"
                  title="Show job description"
                >
                  <Info className="w-4 h-4" />
                </button>
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
                  <span>Container Try: <span className="text-foreground">{(isRunning && liveJobState && liveJobState.attempt > 0) ? liveJobState.attempt : job.retry_count + 1} / {(isRunning && liveJobState && liveJobState.maxAttempts > 1) ? liveJobState.maxAttempts - 1 : maxRetries}</span></span>
                )}
                {liveJobState?.startDateTime && (
                  <span>Agent started: <span className="text-foreground">{new Date(liveJobState.startDateTime).toLocaleString()}</span></span>
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

          {/* Body: 70% Left (logs) / 30% Right (Stepper, Usage, Plan) */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left 70% — Logs */}
            <div className="w-[70%] flex flex-col p-6 border-r border-border min-h-0 overflow-hidden">


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

            {/* Right 30% — Stepper, Usage, Plan */}
            <div className="w-[30%] flex flex-col p-4 gap-3 min-h-0 overflow-hidden bg-card/25">
              <div className="shrink-0">
                <PipelineTimeline
                  status={job.status}
                  stage={liveJobState?.stage ?? job.stage}
                  agentAttempt={liveJobState?.agentAttempt ?? job.agent_attempt}
                  agentMaxRetries={liveJobState?.agentMaxRetries ?? job.agent_max_retries}
                />
              </div>
              <UsagePanel
                usage={liveUsage}
                isExpanded={expandedPanel === 'usage'}
                onExpand={() => setExpandedPanel('usage')}
              />
              <PlanPanel
                entries={livePlan}
                isExpanded={expandedPanel === 'plan'}
                onExpand={() => setExpandedPanel('plan')}
              />
            </div>
          </div>
        </div>
      </div>

      <JobInfoModal job={job} open={infoOpen} onOpenChange={setInfoOpen} />
    </>
  );
}
