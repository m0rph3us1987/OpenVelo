import { useState, useEffect, useCallback } from 'react';

export interface UseProjectStatusResult {
  status: 'running' | 'stopped';
  refresh: () => Promise<void>;
  /** Non-throwing variant of `refresh` safe to await without try/catch. */
  refreshSafe: () => Promise<void>;
}

export function useProjectStatus(projectId: number): UseProjectStatusResult {
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch {
      /* keep previous */
    }
  }, [projectId]);

  // Never let callers' `await refresh()` reject — the background poll will
  // pick up the next state change, so callers can fire-and-forget.
  const safeRefresh = useCallback(async () => {
    try {
      await refresh();
    } catch {
      /* swallow; safeRefresh is intentionally non-throwing */
    }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/projects/${projectId}/status`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setStatus(data.status);
        }
      } catch { /* keep previous */ }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectId]);

  return { status, refresh, refreshSafe: safeRefresh };
}
