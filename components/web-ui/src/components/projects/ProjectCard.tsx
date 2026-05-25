import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EditProjectDialog } from './EditProjectDialog';
import type { Project } from '@/lib/types';

interface ProjectCardProps {
  project: Project;
  onRefresh: () => void;
  liveStatus?: 'running' | 'stopped';
}

export function ProjectCard({ project, onRefresh, liveStatus }: ProjectCardProps) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = React.useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete project "${project.name}"?`)) return;
    await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    onRefresh();
  }

  const effectiveStatus = liveStatus ?? project.status;
  const statusColor = effectiveStatus === 'running'
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : 'text-muted-foreground border-border';

  const statusLabel = effectiveStatus === 'running' ? '● Running' : '○ Stopped';

  return (
    <>
      <Card className="flex flex-col hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => navigate(`/projects/${project.id}`)}>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl font-bold leading-tight">{project.name}</CardTitle>
              <Badge variant="outline" className={statusColor}>{statusLabel}</Badge>
            </div>
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditOpen(true); }} className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={handleDelete} className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-400/10">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => navigate(`/projects/${project.id}`)}>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-5">
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary" className="px-2.5 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded-md">
              Backend: {project.backend}
            </Badge>
            <Badge variant="outline" className="px-2.5 py-1 text-xs font-medium rounded-md border-border text-foreground">
              Port: {project.port}
            </Badge>
            {project.staging_branch && (
              <Badge variant="outline" className="px-2.5 py-1 text-xs font-medium rounded-md border-border text-foreground">
                Branch: ⎇ {project.staging_branch}
              </Badge>
            )}
          </div>
          <div className="mt-auto">
            <p className="text-xs text-muted-foreground mb-1">Full repo:</p>
            <p className="text-sm truncate font-medium text-foreground">
              {project.repo_url || 'No Repository URL configured'}
            </p>
          </div>
        </CardContent>
      </Card>
      <EditProjectDialog
        project={project}
        projectId={project.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onRefresh}
      />
    </>
  );
}
