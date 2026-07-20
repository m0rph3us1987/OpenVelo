import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { cn } from '@/lib/utils';

interface MobileAccordionProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

export function MobileAccordion({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  badge,
  children,
}: MobileAccordionProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isOpen = isControlled ? open : uncontrolledOpen;

  const handleChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  return (
    <Collapsible.Root open={isOpen} onOpenChange={handleChange} className="border-b border-border">
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-label={title}
          className="tap-target w-full flex items-center justify-between gap-2 px-4 text-left text-mobile-h3 font-semibold text-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2 truncate">
            <span className="truncate">{title}</span>
            {badge}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="px-4 pb-4 pt-1">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
