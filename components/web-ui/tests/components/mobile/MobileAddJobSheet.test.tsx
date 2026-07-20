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
import { MobileAddJobSheet } from '@/components/mobile/MobileAddJobSheet';
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
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const sampleEditJob: Job = {
  id: 42,
  project_id: 1,
  title: 'Existing job',
  description: 'existing description',
  status: 'PENDING',
  depends_on: null,
  created_at: '',
  updated_at: '',
};

describe('MobileAddJobSheet', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('pre-fills title when an editJob is provided', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileAddJobSheet as any, {
          open: true,
          onOpenChange: () => {},
          projectId: 1,
          jobs: [sampleEditJob],
          onCreated: () => {},
          editJob: sampleEditJob,
        }),
      })
    );
    await flush();
    const titleInput = container.querySelector('#mobile-job-title') as HTMLInputElement;
    assert.ok(titleInput, 'title input must render');
    assert.strictEqual(titleInput.value, 'Existing job', 'title input must be pre-filled from editJob');
  });

  it('submits a PATCH to /api/projects/:pid/jobs/:id when editing', async () => {
    let lastUrl: string | null = null;
    let lastMethod: string | null = null;
    let onCreatedCount = 0;
    let lastOpen: boolean | null = null;
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      lastUrl = String(url);
      lastMethod = init?.method ?? 'GET';
      return Response.json({ id: 42 }) as Response;
    }) as typeof fetch;

    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileAddJobSheet as any, {
          open: true,
          onOpenChange: (v: boolean) => {
            lastOpen = v;
          },
          projectId: 7,
          jobs: [sampleEditJob],
          onCreated: () => {
            onCreatedCount += 1;
          },
          editJob: sampleEditJob,
        }),
      })
    );
    await flush();
    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save'
    ) as HTMLButtonElement | undefined;
    assert.ok(saveBtn, 'Save button must render in edit mode');
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await flush();
    assert.strictEqual(lastMethod, 'PATCH', 'edit must use PATCH method');
    assert.strictEqual(lastUrl, '/api/projects/7/jobs/42', 'edit must target the correct job URL');
    assert.strictEqual(onCreatedCount, 1, 'onCreated must fire on success');
    assert.strictEqual(lastOpen, false, 'onOpenChange(false) must fire on success');
  });

  it('Create button is disabled when title is empty', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileAddJobSheet as any, {
          open: true,
          onOpenChange: () => {},
          projectId: 1,
          jobs: [],
          onCreated: () => {},
        }),
      })
    );
    await flush();
    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create Job'
    ) as HTMLButtonElement | undefined;
    assert.ok(createBtn, 'Create button must render');
    assert.strictEqual(createBtn.disabled, true, 'Create must be disabled when title is empty');
    assert.ok(createBtn.className.includes('tap-target'), 'Create button must have tap-target class');
  });
});
