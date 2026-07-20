import './_setup';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { MobileConfirmDialog } from '@/components/ui/mobile-confirm-dialog';

function setupDOM() {
  const window = new Window({ url: 'https://localhost' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).navigator = window.navigator;
  Object.defineProperty(global, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    writable: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).matchMedia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
  if (typeof window.history.pushState !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.history as any).pushState = (_state: unknown, _title: string, _url?: string) => {};
  }
}

function TestWrapper({ children }: { children: React.ReactElement }) {
  return React.createElement(BrowserRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null, children)
      )
    )
  );
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('MobileConfirmDialog', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders title and description when open', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileConfirmDialog as any, {
          open: true,
          onOpenChange: () => {},
          title: 'Delete project?',
          description: 'This cannot be undone.',
          confirmLabel: 'Delete',
          onConfirm: () => {},
        }),
      })
    );
    await flush();
    const text = container.textContent || '';
    assert.ok(text.includes('Delete project?'), 'title must render');
    assert.ok(text.includes('This cannot be undone.'), 'description must render');
    assert.ok(text.includes('Delete'), 'confirm label must render');
  });

  it('tapping Confirm calls onConfirm and then onOpenChange(false)', async () => {
    global.fetch = async () => Response.json({}) as Response;
    let confirmCount = 0;
    let lastOpen: boolean | null = null;
    const onOpenChange = (v: boolean) => {
      lastOpen = v;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileConfirmDialog as any, {
          open: true,
          onOpenChange,
          title: 'Confirm?',
          confirmLabel: 'Yes',
          onConfirm: () => {
            confirmCount += 1;
          },
        }),
      })
    );
    await flush();
    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Yes'
    ) as HTMLButtonElement | undefined;
    assert.ok(yesBtn, 'Yes button must render');
    assert.ok(yesBtn.className.includes('tap-target'), 'Yes button must have tap-target class');
    await act(async () => {
      fireEvent.click(yesBtn);
    });
    assert.strictEqual(confirmCount, 1, 'onConfirm must be called exactly once');
    assert.strictEqual(lastOpen, false, 'onOpenChange(false) must be called after confirm');
  });

  it('tapping Cancel calls onOpenChange(false) without calling onConfirm', async () => {
    global.fetch = async () => Response.json({}) as Response;
    let confirmCount = 0;
    let lastOpen: boolean | null = null;
    const onOpenChange = (v: boolean) => {
      lastOpen = v;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileConfirmDialog as any, {
          open: true,
          onOpenChange,
          title: 'Confirm?',
          confirmLabel: 'Yes',
          onConfirm: () => {
            confirmCount += 1;
          },
        }),
      })
    );
    await flush();
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    ) as HTMLButtonElement | undefined;
    assert.ok(cancelBtn, 'Cancel button must render');
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    assert.strictEqual(confirmCount, 0, 'onConfirm must NOT be called on Cancel');
    assert.strictEqual(lastOpen, false, 'onOpenChange(false) must be called on Cancel');
  });

  it('destructive variant renders a destructive confirm button', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileConfirmDialog as any, {
          open: true,
          onOpenChange: () => {},
          title: 'Delete?',
          confirmLabel: 'Delete',
          variant: 'destructive',
          onConfirm: () => {},
        }),
      })
    );
    await flush();
    const delBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete'
    ) as HTMLButtonElement | undefined;
    assert.ok(delBtn, 'Delete button must render');
    assert.ok(delBtn.className.includes('bg-destructive') || delBtn.className.includes('destructive'), 'destructive button must carry destructive styling');
  });
});
