import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StateBadgeProps {
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';
}

export function StateBadge({ status }: StateBadgeProps) {
  const configs = {
    PENDING: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    RUNNING: { label: 'Running', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse' },
    COMPLETED: { label: 'Completed', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
    FAILED: { label: 'Failed', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    STOPPED: { label: 'Stopped', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  };
  const config = configs[status] ?? configs.PENDING;
  return (
    <Badge variant="outline" className={cn('text-xs', config.className)}>
      {config.label}
    </Badge>
  );
}