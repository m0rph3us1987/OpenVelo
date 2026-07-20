import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Monitor, Loader2, ChevronUp, ChevronDown, Terminal } from 'lucide-react';
import RFB from '@novnc/novnc';
import { StateBadge } from '@/components/dashboard/StateBadge';
import { JobTypeBadge } from '@/components/dashboard/JobTypeBadge';
import { LogViewer } from '@/components/dashboard/LogViewer';
import { useJobWebSocket } from '@/hooks/useJobWebSocket';
import { cn, parseSqliteDate } from '@/lib/utils';
import type { Job } from '@/lib/types';

type ConnState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface FailureReason {
  title: string;
  description: string;
}

function elapsed(dateStr: string | null | undefined, _now?: number): string {
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

function classifyClose(code: number, reason: string): FailureReason | null {
  if (code === 1000 && !reason) return null;
  switch (reason) {
    case 'vnc_unreachable':
      return {
        title: 'VNC port unreachable',
        description:
          'The web-ui backend could not reach the tester\'s x11vnc port. Make sure the tester container is running and the host port is accessible (host.docker.internal when running in Docker).',
      };
    case 'vnc_closed':
      return { title: 'VNC closed', description: "The tester's x11vnc process exited." };
    case 'tcp_closed':
      return { title: 'VNC connection lost', description: 'The upstream TCP socket closed unexpectedly.' };
    case 'Conflict: VNC not available for this job':
    case 'vnc_not_running':
      return { title: 'VNC not available', description: 'This job does not have a running VNC server.' };
    default:
      return {
        title: reason ? `Disconnected (${reason})` : `Disconnected (code ${code})`,
        description: 'The VNC connection dropped. You can try reconnecting.',
      };
  }
}

// ~10 lines of mono text at 12px font-size, 1.5 line-height: 12 * 1.5 * 10 = 180px
const LOG_PANEL_HEIGHT = 'h-[15rem]';

export function VncViewerPage() {
  const { id: projectIdParam, jobId: jobIdParam } = useParams<{ id: string; jobId: string }>();
  const projectId = parseInt(projectIdParam ?? '0', 10);
  const jobId = parseInt(jobIdParam ?? '0', 10);

  const canvasParentRef = React.useRef<HTMLDivElement | null>(null);
  const rfbRef = React.useRef<RFB | null>(null);
  const autoReconnectAttemptRef = React.useRef(0);
  const [connState, setConnState] = React.useState<ConnState>('connecting');
  const [failure, setFailure] = React.useState<FailureReason | null>(null);
  const [reconnectNonce, setReconnectNonce] = React.useState(0);
  const [autoReconnectAttempt, setAutoReconnectAttempt] = React.useState(0);
  const [job, setJob] = React.useState<Job | null>(null);

  const [now, setNow] = React.useState(Date.now());
  const [logsExpanded, setLogsExpanded] = React.useState(false);
  const [containerLogs, setContainerLogs] = React.useState<string | null>(null);
  const [logsLoading, setLogsLoading] = React.useState(false);

  const isRunning = job?.status === 'RUNNING';
  const showContainerLogs =
    !!job &&
    (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'STOPPED') &&
    !!job.container_id;

  // Live log stream while the job is RUNNING. The hook connects/disconnects
  // in step with the job lifecycle (mirrors JobDetailModal.tsx:579-582).
  const liveSocket = useJobWebSocket({ jobId, enabled: isRunning });

  // Wipe the live log buffer when the job flips back to RUNNING (mirrors
  // JobDetailModal.tsx:584-588).
  React.useEffect(() => {
    if (isRunning) liveSocket.clearLogs();
  }, [isRunning, liveSocket.clearLogs]);

  // Fetch container logs whenever the panel is expanded AND the job has a
  // container. Reset to null when the panel collapses or the gate flips
  // false. Refetches whenever the job id or terminal status changes.
  React.useEffect(() => {
    if (!logsExpanded || !showContainerLogs || !job || job.project_id == null) {
      setContainerLogs(null);
      return;
    }
    setLogsLoading(true);
    fetch(`/api/projects/${job.project_id}/jobs/${job.id}/container-logs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { logs: string }) => setContainerLogs(data.logs ?? ''))
      .catch(() => setContainerLogs('No logs available'))
      .finally(() => setLogsLoading(false));
  }, [logsExpanded, showContainerLogs, job]);

  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const wsUrl = React.useMemo(() => {
    if (!jobId) return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/vnc/${jobId}`;
  }, [jobId]);

  // Best-effort fetch for the job details so the header band can mirror what
  // the job details modal shows (#id, title, status, type). Failures here are
  // non-fatal — the VNC session is what matters.
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/jobs`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Job[]) => {
        if (cancelled) return;
        const found = rows.find((j) => j.id === jobId) ?? null;
        setJob(found);
      })
      .catch(() => { /* ignore — header will fall back to id-only */ });
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  React.useEffect(() => {
    if (!wsUrl || !canvasParentRef.current) return;
    setConnState('connecting');
    setFailure(null);
    setAutoReconnectAttempt(0);
    autoReconnectAttemptRef.current = 0;

    // Tear down any previous RFB before creating a fresh one. The previous
    // instance has already received its terminal disconnect event (which is
    // why we're being re-run), so calling its disconnect() here would log
    // "Tried changing state of a disconnected RFB object" — noVNC refuses to
    // transition out of the 'disconnected' state. Skip the call and just
    // remove the canvas so the new RFB has a fresh DOM host.
    const previousRfb = rfbRef.current;
    rfbRef.current = null;
    void previousRfb;
    canvasParentRef.current.innerHTML = '';

    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Once we've seen a disconnect on *this* rfb instance, the library
    // considers the state terminal; any further rfb.disconnect() call from
    // our cleanup will noise up the console. Guard the cleanup call.
    let terminated = false;

    const scheduleReconnect = (delayMs: number): void => {
      if (unmounted) return;
      if (reconnectTimer != null) return; // one pending attempt at a time
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (unmounted) return;
        autoReconnectAttemptRef.current += 1;
        setAutoReconnectAttempt(autoReconnectAttemptRef.current);
        setReconnectNonce((n) => n + 1);
      }, delayMs);
    };

    const rfb = new RFB(canvasParentRef.current, wsUrl, {
      credentials: { password: '' },
    });
    rfbRef.current = rfb;

    rfb.viewOnly = true;
    rfb.scaleViewport = false;
    rfb.resizeSession = false;
    rfb.background = '#000';
    rfb.showDotcursor = true;
    rfb.clipViewport = false;

    const onConnect = (): void => {
      setConnState('connected');
      setFailure(null);
      setAutoReconnectAttempt(0);
    };
    const detailOf = (evt: Event): { clean?: boolean; reason?: string; code?: number; status?: number } => {
      const e = evt as unknown as { detail?: { clean?: boolean; reason?: string; code?: number; status?: number } };
      return e.detail ?? {};
    };
    const onDisconnect = (evt: Event): void => {
      // Mark terminated BEFORE running the rest of the handler so the cleanup
      // function (which may run later) can safely skip rfb.disconnect().
      terminated = true;
      const d = detailOf(evt);
      const reason = String(d.reason ?? '');
      const code = Number(d.code ?? 1006);
      // Classify: transient (reconnect) vs terminal (show error and stop).
      //  - 1006 (abnormal closure) with no reason: network/x11vnc hiccup; reconnect.
      //  - 1000 (normal): also treat as transient — x11vnc occasionally
      //    sends an RFB Bye and closes cleanly when a new client is set up.
      //  - 4001+ (we use 1011 for vnc_unreachable): terminal.
      const transient =
        (code === 1006 && (reason === '' || reason === 'vnc_closed')) ||
        code === 1000;
      setConnState('disconnected');
      const classified = classifyClose(code, reason);
      if (transient) {
        // Hide the failure overlay during auto-reconnect so the UX is smooth;
        // surface a small "reconnecting…" pill instead.
        setFailure(null);
        // Exponential backoff: 0.5s, 1s, 2s, 4s, ... capped at 10s.
        const attempt = autoReconnectAttemptRef.current;
        const delay = Math.min(10_000, 500 * Math.pow(2, attempt));
        scheduleReconnect(delay);
      } else if (classified) {
        setFailure(classified);
      }
    };
    const onCredentialsRequired = (): void => {
      setConnState('error');
      setFailure({
        title: 'VNC password required',
        description: 'The tester is configured without a password but the server requested one.',
      });
    };
    const onSecurityFailure = (evt: Event): void => {
      const d = detailOf(evt);
      setConnState('error');
      setFailure({
        title: `Security failure (${d.status ?? '?'})`,
        description: d.reason ?? 'VNC security handshake failed.',
      });
    };

    rfb.addEventListener('connect', onConnect);
    rfb.addEventListener('disconnect', onDisconnect);
    rfb.addEventListener('credentialsrequired', onCredentialsRequired);
    rfb.addEventListener('securityfailure', onSecurityFailure);

    return () => {
      unmounted = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // Only call disconnect() if noVNC hasn't already moved into the terminal
      // 'disconnected' state. Calling it again on a disconnected rfb makes the
      // library spam "Tried changing state of a disconnected RFB object".
      if (!terminated) {
        try { rfb.disconnect(); } catch { /* rfb already torn down */ }
      }
      rfb.removeEventListener('connect', onConnect);
      rfb.removeEventListener('disconnect', onDisconnect);
      rfb.removeEventListener('credentialsrequired', onCredentialsRequired);
      rfb.removeEventListener('securityfailure', onSecurityFailure);
      if (rfbRef.current === rfb) rfbRef.current = null;
    };
  }, [wsUrl, reconnectNonce]);

  // App-level keepalive: sends {"type":"ping"} every ~2 s over the same
  // WebSocket noVNC is using. The backend replies with {"type":"pong"} and
  // discards the frame so the RFB stream stays untouched. With a static
  // remote screen the connection drops every 1-2 s without this — a NAT
  // or proxy layer between the browser and the web-ui backend is killing
  // the idle WebSocket. 2 s is conservative; the frame is ~16 bytes of
  // JSON, so the bandwidth cost is negligible.
  const [keepaliveOpen, setKeepaliveOpen] = React.useState(true);
  React.useEffect(() => {
    if (!keepaliveOpen) return;
    const interval = setInterval(() => {
      const rfb = rfbRef.current as unknown as { _sock?: { _websocket?: WebSocket | null } } | null;
      const ws = rfb?._sock?._websocket ?? null;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (err) {
        // Transient; the reconnect logic will recover.
        console.warn('[VNC] keepalive ping failed:', err);
      }
    }, 2_000);
    return () => clearInterval(interval);
  }, [keepaliveOpen]);

  // Brief pause after a transient disconnect so we don't pile up wasted pings
  // while the rfb is tearing down. Pause keepalive during the reconnect phase
  // so the auto-reconnect timer fires cleanly without contending frame writes.
  React.useEffect(() => {
    setKeepaliveOpen(connState === 'connected');
  }, [connState]);

  const isReconnecting = connState === 'disconnected' && autoReconnectAttempt > 0 && !failure;

  const statusLabel = ((): string => {
    if (isReconnecting) return `Reconnecting (#${autoReconnectAttempt})…`;
    switch (connState) {
      case 'connecting': return 'Connecting…';
      case 'connected': return 'Connected';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Error';
    }
  })();

  const statusColor = ((): string => {
    if (isReconnecting) return 'text-amber-400';
    switch (connState) {
      case 'connecting': return 'text-amber-400';
      case 'connected': return 'text-emerald-400';
      case 'disconnected': return 'text-slate-400';
      case 'error': return 'text-red-400';
    }
  })();

  if (!projectId || !jobId) {
    return (
      <div className="flex flex-1 h-full items-center justify-center p-6 text-muted-foreground">
        Invalid URL — missing project or job id.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 rounded bg-muted/80 px-2 py-0.5 font-mono text-xs font-semibold text-muted-foreground">
            #{jobId}
          </span>
          <h2 className="truncate font-semibold text-foreground leading-snug text-base">
            {job?.title || 'Untitled Job'}
          </h2>
          {job?.status && <StateBadge status={job.status} />}
          {job?.type && <JobTypeBadge type={job.type} />}
          {job && (
            <>
              <span className="text-muted-foreground/50">·</span>
              {job.container_id && (
                <span className="shrink-0">
                  Container:{' '}
                  <span
                    className="text-foreground font-mono select-all"
                    title={job.container_id}
                  >
                    {job.container_id.substring(0, 12)}
                  </span>
                </span>
              )}
              {job.status === 'RUNNING' && (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                  Running for:{' '}
                  <span className="font-mono text-foreground font-medium">
                    {elapsed(job.started_at ?? job.updated_at, now)}
                  </span>
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn('text-xs font-mono', statusColor)}>● {statusLabel}</span>
        </div>
      </header>

      <main className="relative flex-1 min-h-0 bg-black overflow-hidden">
        {connState !== 'connected' && !failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-2 z-10 pointer-events-none">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">
              {isReconnecting
                ? `VNC connection lost — reconnecting (#${autoReconnectAttempt})…`
                : 'Connecting to tester VNC…'}
            </span>
          </div>
        )}
        {failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3 z-10 p-6 text-center">
            <Monitor className="h-8 w-8 opacity-60" />
            <div className="space-y-1">
              <div className="text-base font-medium text-foreground">{failure.title}</div>
              <div className="text-sm text-muted-foreground max-w-md">{failure.description}</div>
            </div>
          </div>
        )}
        <div
          ref={canvasParentRef}
          className="absolute inset-0 overflow-auto bg-black"
        />
      </main>

      {/* Collapsible logs panel — sits BELOW the canvas, never overlays it.
          When expanded it occupies a fixed-height strip (~10 lines). The
          canvas shrinks naturally because it's flex-1 above the panel. */}
      <section
        aria-label="Job logs"
        className={cn(
          'shrink-0 border-t border-border bg-card text-foreground',
          'flex flex-col',
          logsExpanded ? LOG_PANEL_HEIGHT : 'h-9',
        )}
      >
        <button
          type="button"
          onClick={() => setLogsExpanded((v) => !v)}
          aria-expanded={logsExpanded}
          aria-controls="vnc-logs-body"
          className={cn(
            'flex h-9 shrink-0 items-center justify-between gap-2 px-3',
            'text-xs font-semibold text-muted-foreground hover:bg-muted/30',
          )}
        >
          <span className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5" />
            Container logs — Job #{jobId}
          </span>
          {logsExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
        {logsExpanded && (
          <div
            id="vnc-logs-body"
            className="flex-1 min-h-0 overflow-hidden border-t border-border"
          >
            {isRunning ? (
              !liveSocket.isConnected ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10">
                  Connecting to live log…
                </div>
              ) : (
                <LogViewer
                  liveLogs={liveSocket.logs}
                  className="!h-full !min-h-0 h-auto"
                />
              )
            ) : showContainerLogs ? (
              logsLoading ? (
                <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2" />
                  Loading logs from container...
                </div>
              ) : containerLogs ? (
                <LogViewer
                  logs={containerLogs}
                  className="!h-full !min-h-0 h-auto"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10 italic">
                  Container no longer available (No logs saved).
                </div>
              )
            ) : job?.status === 'PENDING' ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted-foreground font-mono bg-muted/10">
                <Terminal className="w-6 h-6 opacity-30 mb-2 animate-pulse text-amber-500" />
                <span className="text-xs font-semibold text-foreground/80 mb-1">Job is Waiting in Queue</span>
                <span className="text-[11px] max-w-[320px] leading-relaxed">
                  This job is pending execution. Once the orchestrator provisions an active agent worker, logs will stream here live.
                </span>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/10 italic">
                No logs available for this job state.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}