import { useState, useEffect } from 'react';

export function useProjectStatus(projectId: number) {
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped');

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

  return status;
}
