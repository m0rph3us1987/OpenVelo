import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { JobList } from '@/components/dashboard/JobList';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useWorkItems } from '@/hooks/useWorkItems';
import type { Project } from '@/lib/types';

interface ProjectContext {
  project: Project;
  projectId: number;
  liveStatus: 'running' | 'stopped' | undefined;
  refreshLiveStatus: () => Promise<void>;
}

export function ProjectPage() {
  const { project, projectId, liveStatus, refreshLiveStatus } = useOutletContext<ProjectContext>();
  const [maxParallel, setMaxParallel] = React.useState(project.max_parallel_jobs ?? 3);

  const { messages: wsMessages } = useWebSocket({ projectId, enabled: true });

  const jobUpdates = React.useMemo(() =>
    wsMessages.filter(m => m.type === 'job_update'),
    [wsMessages]
  );

  const { jobs, refetch } = useWorkItems({
    projectId,
    jobUpdates
  });

  function handleStatusChange(status: 'running' | 'stopped' | 'paused') {
    // Trigger an immediate status re-poll so the header pill flips without
    // waiting for the next 1s background poll tick after the user clicked
    // Start/Stop.
    void status;
    void refreshLiveStatus();
  }

  function handleMaxParallelChange(value: number) {
    setMaxParallel(value);
  }

  const currentStatus = liveStatus as 'running' | 'stopped' | undefined;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden p-4">
      <JobList
        jobs={jobs}
        projectId={projectId}
        maxRetries={project.max_retries ?? 3}
        dockerImage={project.docker_image}
        dockerImageTester={project.docker_image_tester}
        liveStatus={currentStatus ?? 'stopped'}
        maxParallelJobs={maxParallel}
        hasRunningJobs={jobs.some((j) => j.status === 'RUNNING')}
        onJobCreated={refetch}
        onStatusChange={handleStatusChange}
        onMaxParallelChange={handleMaxParallelChange}
      />
    </div>
  );
}