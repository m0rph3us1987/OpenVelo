import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@/lib/types';

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = (await res.json()) as Project[];
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore network errors — keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, loading, refresh };
}