import { Badge } from '@/components/ui/badge';
import { Link2 } from 'lucide-react';
import { parsePredecessorIds } from '@/lib/utils';

interface DependencyBadgeProps {
  dependsOn: string | null;
}

export function DependencyBadge({ dependsOn }: DependencyBadgeProps) {
  const ids = parsePredecessorIds(dependsOn);
  if (ids.length === 0) return null;
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground border-border gap-1">
      <Link2 className="h-3 w-3" />
      Depends on {ids.map((id) => `#${id}`).join(', ')}
    </Badge>
  );
}