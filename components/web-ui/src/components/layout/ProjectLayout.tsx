import * as React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { EditProjectDialog } from '@/components/projects/EditProjectDialog';
import { PasswordGate } from '@/components/auth/PasswordGate';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import type { Project } from '@/lib/types';

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id!);
  const [project, setProject] = React.useState<Project | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  function refreshProject() {
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: Project) => { setProject(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  React.useEffect(() => {
    refreshProject();
  }, [projectId]);

  const liveStatus = useProjectStatus(projectId);

  React.useEffect(() => {
    if (project) setProject({ ...project, status: liveStatus });
  }, [liveStatus]);

  if (loading) return null;
  if (!project) return null;

  const content = (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header
        projectName={project.name}
      />

      <div className="flex-1 flex overflow-hidden">
        <ProjectSidebar projectId={projectId} onSettingsClick={() => setSettingsOpen(true)} />
        <main className="flex-1 overflow-hidden">
          <Outlet context={{ project, projectId, liveStatus }} />
        </main>
      </div>

      {settingsOpen && (
        <EditProjectDialog
          project={project}
          projectId={project.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onUpdated={refreshProject}
        />
      )}
    </div>
  );

  if (project.password_hash) {
    return <PasswordGate projectId={project.id}>{content}</PasswordGate>;
  }
  return content;
}