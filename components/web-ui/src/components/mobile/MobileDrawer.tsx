import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useThemeContext } from '@/components/theme/ThemeProvider';
import { MobileProjectNav } from './MobileProjectNav';
import { MobileGlobalNav } from './MobileGlobalNav';
import { cn } from '@/lib/utils';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: number;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onNavigate?: (path: string) => void;
  onOpenProjectSettings?: () => void;
  onOpenSettings?: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((n) => !n.hasAttribute('disabled') && n.tabIndex !== -1);
}

export function MobileDrawer({
  open,
  onClose,
  projectId,
  triggerRef,
  onNavigate,
  onOpenProjectSettings,
  onOpenSettings,
}: MobileDrawerProps) {
  const { appTitle } = useThemeContext();
  const navigate = useNavigate();
  const handleNavigate = React.useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
      else navigate(path);
    },
    [onNavigate, navigate]
  );
  const [phase, setPhase] = React.useState<'closed' | 'opening' | 'open' | 'closing'>(
    open ? 'opening' : 'closed'
  );

  const startXRef = React.useRef<number | null>(null);
  const deltaXRef = React.useRef<number>(0);
  const asideRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef<boolean>(open);
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  React.useEffect(() => {
    if (open) {
      setPhase('opening');
      const id = window.setTimeout(() => setPhase('open'), 300);
      return () => window.clearTimeout(id);
    }
    const current = phaseRef.current;
    if (current === 'open' || current === 'opening') {
      setPhase('closing');
      const id = window.setTimeout(() => setPhase('closed'), 300);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = getFocusable(asideRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !asideRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !asideRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open && !wasOpenRef.current) {
      const id = window.setTimeout(() => {
        const focusables = getFocusable(asideRef.current);
        if (focusables.length > 0) {
          focusables[0].focus();
        }
      }, 0);
      wasOpenRef.current = true;
      return () => window.clearTimeout(id);
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      const trigger = triggerRef?.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    }
  }, [open, triggerRef]);

  const visible = phase !== 'closed';

  const handleTouchStart = open
    ? (e: React.TouchEvent<HTMLElement>) => {
        startXRef.current = e.touches[0].clientX;
        deltaXRef.current = 0;
      }
    : undefined;

  const handleTouchMove = open
    ? (e: React.TouchEvent<HTMLElement>) => {
        if (startXRef.current !== null) {
          deltaXRef.current = e.touches[0].clientX - startXRef.current;
        }
      }
    : undefined;

  const handleTouchEnd = open
    ? () => {
        if (deltaXRef.current < -50) onClose();
        deltaXRef.current = 0;
        startXRef.current = null;
      }
    : undefined;

  return (
    <aside
      ref={asideRef}
      aria-hidden={!visible}
      aria-label="Side navigation"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn(
        'fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[360px] bg-card border-r border-border shadow-xl flex flex-col pt-safe-top pb-safe-bottom touch-pan-y',
        phase === 'opening' && 'animate-mobile-drawer-in',
        phase === 'closing' && 'animate-mobile-drawer-out',
        phase === 'closed' && 'hidden'
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-mobile-h3 font-semibold truncate text-foreground">
          {appTitle}
        </span>
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="tap-target inline-flex items-center justify-center rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {projectId !== undefined && (
          <MobileProjectNav
            projectId={projectId}
            onNavigate={(path) => {
              handleNavigate(path);
              onClose();
            }}
            onOpenProjectSettings={
              onOpenProjectSettings
                ? () => {
                    onOpenProjectSettings();
                    onClose();
                  }
                : undefined
            }
          />
        )}
        <MobileGlobalNav
          onOpenSettings={() => {
            onOpenSettings?.();
            onClose();
          }}
        />
      </div>
    </aside>
  );
}
