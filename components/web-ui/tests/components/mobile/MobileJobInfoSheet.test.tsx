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
import { MobileJobInfoSheet } from '@/components/mobile/jobs/MobileJobInfoSheet';
import type { Job } from '@/lib/types';

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
  // Stub DOMPurify in the happy-dom environment (its internal factory
  // requires a DOMPurify config that may not be available). The test
  // asserts sanitized output but does not rely on real XSS scrubbing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const dp: any = require('dompurify');
  if (typeof dp?.sanitize !== 'function') {
    dp.sanitize = (html: string) => html;
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

const baseJob: Job = {
  id: 1,
  project_id: 1,
  title: 'Sample job',
  description: '<p>Hello <strong>world</strong></p>',
  status: 'PENDING',
  depends_on: null,
  created_at: '',
  updated_at: '',
};

describe('MobileJobInfoSheet', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders sanitized description and the close button', async () => {
    global.fetch = async () => Response.json({}) as Response;
    let lastOpen: boolean | null = null;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileJobInfoSheet as any, {
          job: baseJob,
          open: true,
          onOpenChange: (v: boolean) => {
            lastOpen = v;
          },
        }),
      })
    );
    await flush();
    const body = container.querySelector('[data-testid="mobile-job-info-body"]') as HTMLElement;
    assert.ok(body, 'body element must render');
    assert.ok(body.textContent?.includes('Hello'), 'sanitized body must contain the text content');
    assert.ok(body.querySelector('strong'), 'sanitized body must keep safe inline markup');
    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    assert.ok(closeBtn, 'close button must render');
    assert.ok(closeBtn.className.includes('tap-target'), 'close button must have tap-target class');
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    assert.strictEqual(lastOpen, false, 'close must call onOpenChange(false)');
  });

  it('renders an empty-state when description is missing', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const emptyJob: Job = { ...baseJob, description: '' };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileJobInfoSheet as any, {
          job: emptyJob,
          open: true,
          onOpenChange: () => {},
        }),
      })
    );
    await flush();
    const empty = container.querySelector('[data-testid="mobile-job-info-empty"]') as HTMLElement;
    assert.ok(empty, 'empty-state must render');
    assert.ok(empty.textContent?.includes('No description'), 'empty-state must explain the missing description');
  });
});
