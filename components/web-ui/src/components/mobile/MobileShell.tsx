import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '@/components/theme/ThemeProvider';
import { MobileTopBar } from './MobileTopBar';
import { MobileDrawer } from './MobileDrawer';
import { cn } from '@/lib/utils';

interface MobileShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  rightSlot?: React.ReactNode;
  projectId?: number;
  onOpenProjectSettings?: () => void;
  onOpenSettings?: () => void;
  onBack?: () => void;
  /**
   * Click handler invoked when the page title is tapped. Pass `null` to
   * explicitly disable title-as-button (the title renders as a plain
   * `<h1>`). When omitted, clicking the title navigates to the projects
   * landing page (`/`).
   */
  onTitleClick?: (() => void) | null;
  children: React.ReactNode;
}

function useBodyScrollLock(open: boolean) {
  const prevRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const body = document.body;
    prevRef.current = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevRef.current ?? '';
      prevRef.current = null;
    };
  }, [open]);
}

function useEscapeClose(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

function usePopstateClose(open: boolean, onClose: () => void) {
  const pushedRef = React.useRef(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!open) return;
    if (!pushedRef.current) {
      window.history.pushState({ mobileDrawer: true }, '');
      pushedRef.current = true;
    }
    const onPop = () => {
      if (pushedRef.current) {
        pushedRef.current = false;
        onClose();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (pushedRef.current) {
        pushedRef.current = false;
        // Restore the history entry we pushed if we close without the user pressing back
        window.history.go(1);
      }
    };
  }, [open, onClose]);
}

export function MobileShell({
  open,
  onOpenChange,
  title,
  rightSlot,
  projectId,
  onOpenProjectSettings,
  onOpenSettings,
  onBack,
  onTitleClick,
  children,
}: MobileShellProps) {
  const { appTitle } = useThemeContext();
  const navigate = useNavigate();
  const onClose = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const onMenuClick = React.useCallback(() => onOpenChange(true), [onOpenChange]);
  const hamburgerRef = React.useRef<HTMLButtonElement | null>(null);

  useBodyScrollLock(open);
  useEscapeClose(open, onClose);
  usePopstateClose(open, onClose);

  const resolvedTitle = title ?? appTitle;
  const handleBack = React.useCallback(() => {
    if (onBack) onBack();
    else navigate(-1);
  }, [onBack, navigate]);

  const resolvedTitleClick = React.useMemo(() => {
    if (onTitleClick === null) return null;
    if (onTitleClick) return onTitleClick;
    return () => navigate('/');
  }, [onTitleClick, navigate]);

  const [scrimPhase, setScrimPhase] = React.useState<'hidden' | 'entering' | 'visible' | 'leaving'>(
    open ? 'entering' : 'hidden'
  );
  const scrimPhaseRef = React.useRef(scrimPhase);
  React.useEffect(() => {
    scrimPhaseRef.current = scrimPhase;
  }, [scrimPhase]);
  React.useEffect(() => {
    if (open) {
      setScrimPhase('entering');
      const id = window.setTimeout(() => setScrimPhase('visible'), 300);
      return () => window.clearTimeout(id);
    }
    const current = scrimPhaseRef.current;
    if (current === 'visible' || current === 'entering') {
      setScrimPhase('leaving');
      const id = window.setTimeout(() => setScrimPhase('hidden'), 300);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  return (
    <div className="h-dvh min-h-dvh flex flex-col bg-background">
      <MobileTopBar ref={hamburgerRef} title={resolvedTitle} onMenuClick={onMenuClick} onBack={onBack ? handleBack : undefined} rightSlot={rightSlot} onTitleClick={resolvedTitleClick} />
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      {scrimPhase !== 'hidden' && (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          onClick={onClose}
          className={cn(
            'fixed inset-0 z-40 bg-black/50 border-0 p-0 cursor-default',
            open ? 'pointer-events-auto' : 'pointer-events-none',
            scrimPhase === 'entering' && 'animate-mobile-scrim-in',
            scrimPhase === 'leaving' && 'animate-mobile-scrim-out'
          )}
        />
      )}

      <MobileDrawer
        open={open}
        onClose={onClose}
        projectId={projectId}
        triggerRef={hamburgerRef}
        onNavigate={navigate}
        onOpenProjectSettings={onOpenProjectSettings}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}