import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Viewport = 'phone' | 'tablet';

function detectViewport(): Viewport {
  if (typeof window === 'undefined') return 'phone';
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 641px)').matches) {
      return 'tablet';
    }
  } catch {
    /* ignore */
  }
  return 'phone';
}

export interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'bottom' | 'top' | 'full';
  footer?: React.ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
  className?: string;
  closeLabel?: string;
}

export function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  variant = 'bottom',
  footer,
  scrollRef,
  children,
  className,
  closeLabel = 'Close',
}: MobileSheetProps) {
  const [viewport, setViewport] = React.useState<Viewport>(detectViewport);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setViewport(detectViewport());
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 641px)') : null;
    mql?.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
    return () => {
      mql?.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prev;
    };
  }, [open]);

  const effectiveVariant: 'bottom' | 'top' | 'full' = variant === 'bottom' && viewport === 'tablet' ? 'top' : variant;

  const variantClass = cn(
    'flex flex-col gap-3 overflow-hidden',
    effectiveVariant === 'bottom' &&
      'left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 max-h-[90vh] rounded-t-2xl rounded-b-none p-4 pb-safe-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
    effectiveVariant === 'top' &&
      'left-0 right-0 top-0 bottom-auto translate-x-0 translate-y-0 max-h-[85vh] rounded-t-none rounded-b-2xl p-4 pt-safe-top data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
    effectiveVariant === 'full' &&
      'inset-0 left-0 right-0 top-0 bottom-0 translate-x-0 translate-y-0 max-h-none rounded-none p-0 pt-safe-top pb-safe-bottom',
    className,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={variantClass}
        aria-describedby={description ? 'mobile-sheet-description' : undefined}
        showCloseButton={false}
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-1 block h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
        />

        <div
          className={cn(
            'flex shrink-0 items-center justify-between gap-2 border-b border-border',
            effectiveVariant === 'full' ? 'px-4 py-3' : 'pb-2',
          )}
        >
          <DialogTitle className="text-mobile-h2 font-semibold text-foreground">
            {title}
          </DialogTitle>
          <DialogClose
            className="tap-target inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </div>

        {description && (
          <DialogDescription
            id="mobile-sheet-description"
            className="text-mobile-caption text-muted-foreground"
          >
            {description}
          </DialogDescription>
        )}

        <div
          ref={scrollRef}
          className={cn(
            'flex-1 min-h-0 overflow-y-auto',
            effectiveVariant === 'full' ? 'px-4' : '-mx-1 px-1',
          )}
        >
          {children}
        </div>

        {footer && (
          <div
            className={cn(
              'flex shrink-0 flex-col gap-2 border-t border-border pt-3',
              effectiveVariant === 'full' ? 'px-4 pb-safe-bottom' : 'pb-safe-bottom sm:flex-row sm:justify-end sm:gap-2',
            )}
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
