import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog } from './CreateProjectDialog';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/context/AuthContext';
import type { Project } from '@/lib/types';

function ProjectCardWithStatus({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const { status: liveStatus } = useProjectStatus(project.id);
  return <ProjectCard key={project.id} project={project} onRefresh={onRefresh} liveStatus={liveStatus} />;
}

export function ProjectList() {
  const { isAdmin } = useAuth();
  const { projects, refresh: refreshProjects } = useProjects();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">In this section you can create and manage projects</p>
          </div>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          )}
        </div>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center shrink-0">
          <p className="text-lg font-medium text-foreground">No projects yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-6">Create your first project to get started</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-2 pb-8 flex flex-col gap-4">
          {projects.map((project) => (
            <ProjectCardWithStatus key={project.id} project={project} onRefresh={refreshProjects} />
          ))}
        </div>
      )}
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refreshProjects}
      />
    </div>
  );
}