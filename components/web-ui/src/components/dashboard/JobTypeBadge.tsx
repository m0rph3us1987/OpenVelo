import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface JobTypeBadgeProps {
  type: 'implementation' | 'test';
}

export function JobTypeBadge({ type }: JobTypeBadgeProps) {
  const configs = {
    implementation: { label: 'Implement', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    test: { label: 'Test', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  };
  const config = configs[type] ?? configs.implementation;
  return (
    <Badge variant="outline" className={cn('text-xs', config.className)}>
      {config.label}
    </Badge>
  );
}