import * as React from 'react';
import { ChevronLeft, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileTopBarProps {
  title: string;
  onMenuClick: () => void;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  onTitleClick?: (() => void) | null;
}

export const MobileTopBar = React.forwardRef<HTMLButtonElement, MobileTopBarProps>(function MobileTopBar(
  { title, onMenuClick, onBack, rightSlot, onTitleClick },
  ref
) {
  const showTitleButton = typeof onTitleClick === 'function';
  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border pt-safe-top">
      <div className="flex items-center justify-between gap-2 px-2 min-h-[56px]">
        <button
          ref={ref}
          type="button"
          aria-label="Open navigation"
          onClick={onMenuClick}
          className="tap-target inline-flex items-center justify-center rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-6 w-6" />
        </button>
        {onBack ? (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="tap-target inline-flex items-center justify-center rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {showTitleButton ? (
          <button
            type="button"
            aria-label="Go to projects"
            onClick={onTitleClick ?? undefined}
            className={cn(
              'tap-target text-mobile-h3 font-semibold truncate text-left flex-1 px-2 rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {title}
          </button>
        ) : (
          <h1 className="text-mobile-h3 font-semibold truncate text-foreground flex-1">
            {title}
          </h1>
        )}
        <div className="tap-target inline-flex items-center justify-center" aria-hidden={rightSlot ? undefined : true}>
          {rightSlot}
        </div>
      </div>
    </header>
  );
});
