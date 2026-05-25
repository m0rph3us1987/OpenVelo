import { useState, useEffect, useCallback } from 'react';
import type { Job, WsJobUpdateMessage } from '@/lib/types';
import { topoSortJobs } from '@/lib/utils';

interface UseWorkItemsOptions {
  projectId: number;
  jobUpdates: WsJobUpdateMessage[];
}

export function useWorkItems({
  projectId,
  jobUpdates,
}: UseWorkItemsOptions) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs`);
      if (res.ok) {
        const data = (await res.json()) as Job[];
        setJobs(topoSortJobs(data));
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Refresh job list every 5 s
  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(() => void fetchJobs(), 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Apply WS job-update messages optimistically
  useEffect(() => {
    if (jobUpdates.length === 0) return;
    const lastUpdate = jobUpdates[jobUpdates.length - 1];
    if (!lastUpdate) return;
    setJobs((prev) =>
      topoSortJobs(
        prev.map((j) => {
          if (j.id !== lastUpdate.jobId) return j;
          const updated: Job = { ...j, status: lastUpdate.status as Job['status'] };
          if (lastUpdate.stage !== undefined) updated.stage = lastUpdate.stage;
          if (lastUpdate.agentAttempt !== undefined) updated.agent_attempt = lastUpdate.agentAttempt;
          if (lastUpdate.agentMaxRetries !== undefined) updated.agent_max_retries = lastUpdate.agentMaxRetries;
          return updated;
        })
      )
    );
  }, [jobUpdates]);

  return { jobs, isLoading, refetch: fetchJobs };
}
