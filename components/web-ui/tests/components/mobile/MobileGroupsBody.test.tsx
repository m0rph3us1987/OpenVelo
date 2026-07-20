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
import { MobileGroupsTab } from '@/components/mobile/MobileGroupsBody';

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

describe('MobileGroupsTab', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders the group list with tap-target controls', async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u === '/api/groups') {
        return Response.json([
          { id: 1, name: 'engineers', members: [{ id: 1, username: 'alice' }], projects: [] },
        ]) as Response;
      }
      if (u === '/api/users') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    }) as typeof fetch;

    const { container } = render(
      TestWrapper({ children: React.createElement(MobileGroupsTab) })
    );
    await flush();
    const text = container.textContent || '';
    assert.ok(text.includes('engineers'), 'group name must render');
    const deleteBtn = container.querySelector('button[aria-label="Delete engineers"]') as HTMLButtonElement;
    assert.ok(deleteBtn, 'Delete button must render');
    assert.ok(deleteBtn.className.includes('tap-target'), 'Delete button must have tap-target class');
  });

  it('opens a destructive confirm dialog when delete is tapped', async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u === '/api/groups') {
        return Response.json([
          { id: 1, name: 'engineers', members: [], projects: [] },
        ]) as Response;
      }
      if (u === '/api/users') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    }) as typeof fetch;

    const { container } = render(
      TestWrapper({ children: React.createElement(MobileGroupsTab) })
    );
    await flush();
    const deleteBtn = container.querySelector('button[aria-label="Delete engineers"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    await flush();
    const text = container.textContent || '';
    assert.ok(text.includes('Delete group'), 'confirm dialog must show Delete group title');
    assert.ok(text.includes('engineers'), 'confirm dialog must mention the group name');
  });
});
