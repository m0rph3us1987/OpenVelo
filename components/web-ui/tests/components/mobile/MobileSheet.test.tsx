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
import { MobileSheet } from '@/components/ui/mobile-sheet';

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

describe('MobileSheet', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders the title when open and locks body scroll', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileSheet as any, {
          open: true,
          onOpenChange: () => {},
          title: 'Hello sheet',
          children: React.createElement('div', null, 'body content'),
        }),
      })
    );
    await flush();
    assert.strictEqual(document.body.style.overflow, 'hidden', 'body scroll must be locked while open');
    assert.ok(container.textContent?.includes('Hello sheet'), 'title text must be present in the DOM');
  });

  it('close button has tap-target class and calls onOpenChange(false)', async () => {
    global.fetch = async () => Response.json({}) as Response;
    let lastOpen: boolean | null = null;
    const onOpenChange = (v: boolean) => {
      lastOpen = v;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileSheet as any, {
          open: true,
          onOpenChange,
          title: 'Close test',
          children: React.createElement('div', null, 'body'),
        }),
      })
    );
    await flush();
    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    assert.ok(closeBtn, 'close button must render');
    assert.ok(closeBtn.className.includes('tap-target'), 'close button must have tap-target class');
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    assert.strictEqual(lastOpen, false, 'onOpenChange must be called with false');
  });

  it('Escape key while open calls onOpenChange(false)', async () => {
    global.fetch = async () => Response.json({}) as Response;
    let lastOpen: boolean | null = null;
    const onOpenChange = (v: boolean) => {
      lastOpen = v;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileSheet as any, {
          open: true,
          onOpenChange,
          title: 'Escape test',
          children: React.createElement('div', null, 'body'),
        }),
      })
    );
    await flush();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    assert.strictEqual(lastOpen, false, 'Escape must close the sheet');
    void container;
  });

  it('pinned footer is rendered with safe-area padding class', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileSheet as any, {
          open: true,
          onOpenChange: () => {},
          title: 'Footer test',
          footer: React.createElement('button', { className: 'tap-target' }, 'Save'),
          children: React.createElement('div', null, 'body'),
        }),
      })
    );
    await flush();
    const html = container.innerHTML;
    assert.ok(html.includes('pb-safe-bottom'), 'footer must apply pb-safe-bottom');
    assert.ok(html.includes('Save'), 'footer content must render');
  });
});
