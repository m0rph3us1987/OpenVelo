import * as React from 'react';
import { cn } from '@/lib/utils';

export interface MobileTabItem {
  id: string;
  label: string;
}

interface MobileTabBarProps {
  items: MobileTabItem[];
  activeId: string;
  onChange: (id: string) => void;
}

export function MobileTabBar({ items, activeId, onChange }: MobileTabBarProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-[56px] z-20 bg-background border-b border-border"
    >
      <ul className="flex items-center gap-1 overflow-x-auto px-2 min-h-[48px]">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => onChange(item.id)}
                className={cn(
                  'tap-target inline-flex items-center justify-center whitespace-nowrap px-4 text-mobile-body rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground'
                )}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
