import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileProjectCard } from './MobileProjectCard';
import { MobileCreateProjectDialog } from './MobileCreateProjectDialog';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/context/AuthContext';
import type { Project } from '@/lib/types';

function MobileProjectCardWithStatus({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const { status: liveStatus } = useProjectStatus(project.id);
  return <MobileProjectCard project={project} onRefresh={onRefresh} liveStatus={liveStatus} />;
}

export function MobileProjectList() {
  const { isAdmin } = useAuth();
  const { projects, loading, refresh } = useProjects();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <div className="flex flex-col" role="region" aria-label="Projects">
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-mobile-h1 font-bold text-foreground">Projects</h1>
          <p className="text-mobile-body text-muted-foreground mt-1">
            In this section you can create and manage projects
          </p>
        </div>
        {isAdmin && (
          <Button
            type="button"
            className="tap-target shrink-0"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-bottom">
        {loading ? (
          <ul className="flex flex-col gap-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="min-h-[64px] w-full rounded-md bg-muted/30 animate-pulse" />
            ))}
          </ul>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-mobile-h3 font-medium text-foreground">No projects yet</p>
            <p className="text-mobile-body text-muted-foreground mt-2">
              Create your first project to get started
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={project.id}>
                <MobileProjectCardWithStatus project={project} onRefresh={refresh} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <MobileCreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
      />
    </div>
  );
}
