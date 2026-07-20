// In-tree Radix Dialog mock for happy-dom.
//
// Radix UI's Dialog primitive does not render content under happy-dom because
// it depends on browser APIs (focus-trap, IntersectionObserver) that the
// environment does not implement. The components under test still need their
// markup, hooks, and event handlers exercised end-to-end, so we intercept
// the `@/components/ui/dialog` module via the Node module cache and replace
// its exports with an in-tree implementation that renders children inline
// (no portal, no overlay focus-trap, no Radix state machine).
//
// Call `installDialogMock()` from `beforeEach()` BEFORE rendering anything
// that imports `@/components/ui/dialog`.

import * as React from 'react';
import * as Module from 'node:module';

const DialogOnOpenChangeContext = React.createContext<(v: boolean) => void>(() => {});

function InlineDialog({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return React.createElement(
    DialogOnOpenChangeContext.Provider,
    { value: onOpenChange },
    React.createElement('div', { role: 'dialog', 'aria-modal': 'true', 'data-state': 'open' }, children),
  );
}

function InlineDialogTrigger({ children, ...rest }: { children?: React.ReactNode; asChild?: boolean }) {
  return React.createElement(React.Fragment, rest as Record<string, unknown>, children);
}

function InlineDialogPortal({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

function InlineDialogOverlay({ onClick }: { onClick?: React.MouseEventHandler<HTMLElement> }) {
  return React.createElement('button', {
    type: 'button',
    'aria-label': 'Close overlay',
    onClick,
    'data-testid': 'mock-overlay',
  });
}

function InlineDialogContent({
  className,
  children,
  showCloseButton = true,
  onClick,
  ...rest
}: {
  className?: string;
  children?: React.ReactNode;
  showCloseButton?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onInteractOutside?: (e: { preventDefault: () => void }) => void;
  onPointerDownOutside?: (e: { preventDefault: () => void }) => void;
}) {
  const onOpenChange = React.useContext(DialogOnOpenChangeContext);
  return React.createElement(
    'div',
    {
      className,
      ...rest,
      role: 'dialog',
      'aria-modal': 'true',
      'data-state': 'open',
      onClick,
    },
    children,
    showCloseButton
      ? React.createElement(
          'button',
          {
            type: 'button',
            'aria-label': 'Close',
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onOpenChange(false);
            },
            className: 'absolute right-4 top-4',
          },
          '×',
        )
      : null,
  );
}

function InlineDialogHeader({ className, children, ...rest }: { className?: string; children?: React.ReactNode }) {
  return React.createElement('div', { className, ...rest }, children);
}

function InlineDialogFooter({ className, children, ...rest }: { className?: string; children?: React.ReactNode }) {
  return React.createElement('div', { className, ...rest }, children);
}

function InlineDialogTitle({ className, children, ...rest }: { className?: string; children?: React.ReactNode }) {
  return React.createElement('h2', { className, ...rest }, children);
}

function InlineDialogDescription({ className, children, id, ...rest }: { className?: string; children?: React.ReactNode; id?: string }) {
  return React.createElement('p', { className, id, ...rest }, children);
}

function InlineDialogClose({ children, className, onClick, ...rest }: { children?: React.ReactNode; className?: string; onClick?: React.MouseEventHandler }) {
  const onOpenChange = React.useContext(DialogOnOpenChangeContext);
  return React.createElement(
    'button',
    {
      type: 'button',
      className,
      onClick: (e: React.MouseEvent) => {
        onClick?.(e);
        if (!e.defaultPrevented) onOpenChange(false);
      },
      ...rest,
    },
    children,
  );
}

let installed = false;

export function installDialogMock() {
  if (installed) return;
  installed = true;
  installNow();
}

function installNow() {
  const mod = Module as unknown as { _cache?: Record<string, unknown> };
  const cache = mod._cache;
  if (!cache) return;

  let dialogPath: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    dialogPath = require.resolve('@/components/ui/dialog');
  } catch {
    return;
  }

  cache[dialogPath] = {
    id: dialogPath,
    filename: dialogPath,
    loaded: true,
    exports: {
      __esModule: true,
      Dialog: InlineDialog,
      DialogTrigger: InlineDialogTrigger,
      DialogPortal: InlineDialogPortal,
      DialogOverlay: InlineDialogOverlay,
      DialogContent: InlineDialogContent,
      DialogHeader: InlineDialogHeader,
      DialogFooter: InlineDialogFooter,
      DialogTitle: InlineDialogTitle,
      DialogDescription: InlineDialogDescription,
      DialogClose: InlineDialogClose,
    },
  };
}

// Install immediately on import so any subsequent `import` of the dialog
// module (which happens during the test file's own top-level imports) gets
// the in-tree implementation.
installNow();
