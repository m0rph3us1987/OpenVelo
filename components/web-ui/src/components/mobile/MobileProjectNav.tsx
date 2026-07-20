import * as React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, LayoutDashboard, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileProjectNavProps {
  projectId: number;
  onNavigate?: (path: string) => void;
  onOpenProjectSettings?: () => void;
}

type RowId = 'jobs' | 'plan' | 'settings';

interface NavRow {
  id: RowId;
  label: string;
  icon: React.ElementType;
  isActive: (locationPath: string, projectId: number) => boolean;
  onSelect: (
    projectId: number,
    handlers: {
      navigate: (p: string) => void;
      onNavigate?: (p: string) => void;
      onOpenProjectSettings?: () => void;
    }
  ) => void;
}

const ROWS: NavRow[] = [
  {
    id: 'jobs',
    label: 'Jobs',
    icon: Briefcase,
    isActive: (path, projectId) => path === `/projects/${projectId}`,
    onSelect: (projectId, { navigate }) => navigate(`/projects/${projectId}`),
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: LayoutDashboard,
    isActive: (path, projectId) => path.startsWith(`/projects/${projectId}/plan`),
    onSelect: (projectId, { navigate }) => navigate(`/projects/${projectId}/plan`),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    isActive: () => false,
    onSelect: (_projectId, { onOpenProjectSettings }) => onOpenProjectSettings?.(),
  },
];

export function MobileProjectNav({
  projectId,
  onNavigate,
  onOpenProjectSettings,
}: MobileProjectNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav aria-label="Project navigation" className="flex flex-col">
      <div className="px-4 pt-4 pb-2 text-mobile-caption uppercase tracking-wide text-muted-foreground">
        Project
      </div>
      <ul className="flex flex-col">
        {ROWS.map((row) => {
          const Icon = row.icon;
          const active = row.isActive(location.pathname, projectId);
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() =>
                  row.onSelect(projectId, { navigate, onNavigate, onOpenProjectSettings })
                }
                className={cn(
                  'tap-target w-full text-left px-4 py-3 text-base flex items-center gap-3 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{row.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
