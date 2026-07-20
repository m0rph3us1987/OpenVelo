import * as React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Circle } from 'lucide-react';
import { MobileShell } from './MobileShell';
import { MobileEditProjectDialog } from './MobileEditProjectDialog';
import { MobileSettingsDialog } from './MobileSettingsDialog';
import { PasswordGate } from '@/components/auth/PasswordGate';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

export function MobileProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id!, 10);
  const [project, setProject] = React.useState<Project | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = React.useState(false);

  function refreshProject() {
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: Project) => {
        setProject(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  React.useEffect(() => {
    refreshProject();
  }, [projectId]);

  const { status: liveStatus, refreshSafe: refreshLiveStatus } = useProjectStatus(projectId);
  const liveProject = React.useMemo<Project | null>(() => {
    if (!project) return null;
    return { ...project, status: liveStatus };
  }, [project, liveStatus]);

  if (loading) return null;
  if (!liveProject) return null;

  const liveStatusPill = (
    <span
      aria-label={`Orchestrator ${liveStatus ?? 'unknown'}`}
      className="tap-target inline-flex items-center gap-1 px-2 text-mobile-caption rounded-full bg-card border border-border"
    >
      <Circle
        aria-hidden="true"
        className={cn(
          'h-2.5 w-2.5',
          liveStatus === 'running' ? 'fill-green-400 text-green-400' : 'fill-red-500 text-red-500'
        )}
      />
      <span className="text-foreground">
        {liveStatus === 'running' ? 'Running' : 'Stopped'}
      </span>
    </span>
  );

  const content = (
    <>
      <MobileShell
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        projectId={liveProject.id}
        onOpenProjectSettings={() => setSettingsOpen(true)}
        onOpenSettings={() => setAppSettingsOpen(true)}
        rightSlot={liveStatusPill}
      >
        <Outlet context={{ project: liveProject, projectId, liveStatus, refreshLiveStatus }} />
        {settingsOpen && (
          <MobileEditProjectDialog
            project={liveProject}
            projectId={liveProject.id}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onUpdated={refreshProject}
          />
        )}
      </MobileShell>
      <MobileSettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen} />
    </>
  );

  if (liveProject.password_hash) {
    return <PasswordGate projectId={liveProject.id}>{content}</PasswordGate>;
  }
  return content;
}