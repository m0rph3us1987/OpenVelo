import * as React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Settings, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  action?: () => void;
  path?: string;
}

interface ProjectSidebarProps {
  projectId: number;
  onSettingsClick?: () => void;
}

export function ProjectSidebar({ projectId, onSettingsClick }: ProjectSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const NAV_ITEMS: NavItem[] = [
    { id: 'jobs', label: 'Jobs', icon: Briefcase, path: '' },
    { id: 'plan', label: 'Plan', icon: LayoutDashboard, path: 'plan' },
    { id: 'settings', label: 'Settings', icon: Settings, action: onSettingsClick },
  ];

  function handleNavClick(item: NavItem) {
    if (item.action) {
      item.action();
    } else if (item.id === 'jobs') {
      navigate(`/projects/${projectId}`);
    } else if (item.id === 'plan') {
      navigate(`/projects/${projectId}/plan`);
    }
  }

  function isActive(item: NavItem): boolean {
    if (item.id === 'jobs') {
      return location.pathname === `/projects/${projectId}`;
    }
    if (item.id === 'plan') {
      return location.pathname.startsWith(`/projects/${projectId}/plan`);
    }
    return false;
  }

  return (
    <nav className="w-[70px] h-full bg-card border-r border-border flex flex-col items-center py-4 gap-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <button
            key={item.id}
            onClick={() => handleNavClick(item)}
            className={cn(
              'w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title={item.label}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}