import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { MobileAddJobSheet } from '@/components/mobile/MobileAddJobSheet';
import { MobileJobDetailStack } from '@/components/mobile/jobs/MobileJobDetailStack';
import { MobileJobList } from '@/components/mobile/jobs/MobileJobList';
import { MobileStatusHeader } from '@/components/mobile/jobs/MobileStatusHeader';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useWorkItems } from '@/hooks/useWorkItems';
import type { Project, WsJobUpdateMessage } from '@/lib/types';

interface MobileProjectContext {
  project: Project;
  projectId: number;
  liveStatus: 'running' | 'stopped' | undefined;
  refreshLiveStatus: () => Promise<void>;
}

export function MobileProjectPage() {
  const { project, projectId, liveStatus, refreshLiveStatus } = useOutletContext<MobileProjectContext>();

  const [selectedJobId, setSelectedJobId] = React.useState<number | null>(null);
  const [addJobOpen, setAddJobOpen] = React.useState(false);
  const listScrollRef = React.useRef<HTMLDivElement>(null);
  const savedScrollTop = React.useRef<number>(0);

  const { messages: wsMessages } = useWebSocket({ projectId, enabled: true });

  const jobUpdates = React.useMemo<WsJobUpdateMessage[]>(
    () => wsMessages.filter((m): m is WsJobUpdateMessage => m.type === 'job_update'),
    [wsMessages]
  );

  const { jobs, refetch, isLoading } = useWorkItems({ projectId, jobUpdates });

  const activeJob = React.useMemo(
    () => (selectedJobId === null ? null : jobs.find((j) => j.id === selectedJobId) ?? null),
    [jobs, selectedJobId]
  );

  function openJob(id: number) {
    savedScrollTop.current = listScrollRef.current?.scrollTop ?? 0;
    setSelectedJobId(id);
  }

  function closeJob() {
    setSelectedJobId(null);
    requestAnimationFrame(() => {
      const el = listScrollRef.current;
      if (el) el.scrollTop = savedScrollTop.current;
    });
  }

  React.useEffect(() => {
    if (selectedJobId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedJobId(null);
        requestAnimationFrame(() => {
          const el = listScrollRef.current;
          if (el) el.scrollTop = savedScrollTop.current;
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedJobId]);

  const hasRunningJobs = jobs.some((j) => j.status === 'RUNNING');

  if (selectedJobId !== null && activeJob) {
    return (
      <MobileJobDetailStack
        job={activeJob}
        project={project}
        maxRetries={project.max_retries ?? 3}
        onBack={closeJob}
        onDeleted={() => void refetch()}
      />
    );
  }

  if (isLoading && jobs.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[60vh] items-center justify-center text-muted-foreground"
      >
        <span className="text-mobile-body">Loading jobs…</span>
      </div>
    );
  }

  return (
    <div role="main" className="flex flex-col pb-safe-bottom">
      <MobileStatusHeader
        project={project}
        projectId={projectId}
        liveStatus={liveStatus}
        hasRunningJobs={hasRunningJobs}
        onAddJob={() => setAddJobOpen(true)}
        onAfterAction={refreshLiveStatus}
      />
      <div
        ref={listScrollRef}
        className="flex-1 overflow-y-auto px-safe"
        data-testid="mobile-job-list-scroll"
      >
        <MobileJobList
          jobs={jobs}
          isLoading={isLoading}
          onSelect={openJob}
          onAddJob={() => setAddJobOpen(true)}
        />
      </div>
      <MobileAddJobSheet
        open={addJobOpen}
        onOpenChange={setAddJobOpen}
        projectId={projectId}
        jobs={jobs}
        onCreated={() => void refetch()}
      />
    </div>
  );
}
