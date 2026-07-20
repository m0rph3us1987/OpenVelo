import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MobileConfirmDialog } from '@/components/ui/mobile-confirm-dialog';
import { MobileEditProjectDialog } from './MobileEditProjectDialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import type { Project } from '@/lib/types';

interface MobileProjectCardProps {
  project: Project;
  onRefresh: () => void;
  liveStatus?: 'running' | 'stopped';
}

export function MobileProjectCard({ project, onRefresh, liveStatus }: MobileProjectCardProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const effectiveStatus = liveStatus ?? project.status;
  const statusColor = effectiveStatus === 'running'
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : 'text-muted-foreground border-border';
  const statusLabel = effectiveStatus === 'running' ? '● Running' : '○ Stopped';

  async function handleDelete() {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to delete project', 'error');
        throw new Error('delete failed');
      }
      showToast(`Deleted project "${project.name}"`, 'success');
      onRefresh();
    } catch (err) {
      if (err instanceof Error && err.message === 'delete failed') throw err;
      showToast('Failed to delete project', 'error');
      throw err;
    }
  }

  function handleCardClick() {
    navigate(`/projects/${project.id}`);
  }

  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  }

  return (
    <>
      <article
        data-testid="mobile-project-card"
        role="button"
        tabIndex={0}
        aria-label={`Open ${project.name}`}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        className={cn(
          'min-h-[64px] w-full flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-4 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h3 className="text-mobile-h3 font-semibold text-foreground truncate">
              {project.name}
            </h3>
            <Badge variant="outline" className={cn('self-start px-2 py-0.5 text-mobile-caption rounded-md', statusColor)}>
              {statusLabel}
            </Badge>
          </div>
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Edit ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditOpen(true);
              }}
              className="tap-target h-10 w-10 text-muted-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Delete ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
              className="tap-target h-10 w-10 text-muted-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Open ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                handleCardClick();
              }}
              className="tap-target h-10 w-10 text-muted-foreground"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary" className="px-2.5 py-1 text-mobile-caption font-medium bg-secondary text-secondary-foreground rounded-md">
            Backend: {project.backend}
          </Badge>
          <Badge variant="outline" className="px-2.5 py-1 text-mobile-caption font-medium rounded-md border-border text-foreground">
            Port: {project.port}
          </Badge>
          {project.staging_branch && (
            <Badge variant="outline" className="px-2.5 py-1 text-mobile-caption font-medium rounded-md border-border text-foreground">
              Branch: ⎇ {project.staging_branch}
            </Badge>
          )}
        </div>
        <div>
          <p className="text-mobile-caption text-muted-foreground mb-0.5">Full repo:</p>
          <p className="text-mobile-body font-medium text-foreground truncate">
            {project.repo_url || 'No Repository URL configured'}
          </p>
        </div>
      </article>
      <MobileEditProjectDialog
        project={project}
        projectId={project.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onRefresh}
      />
      <MobileConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${project.name}"?`}
        description="This permanently removes the project. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
