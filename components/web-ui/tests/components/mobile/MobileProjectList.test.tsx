import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { MobileProjectList } from '@/components/mobile/MobileProjectList';

function setupDOM() {
  const window = new Window({ url: 'https://localhost/' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).navigator = window.navigator;
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
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
}

function TestWrapper({ children }: { children: React.ReactElement }) {
  return React.createElement(BrowserRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null,
          children
        )
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

describe('MobileProjectList', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders a project card with tap-target open action and min-h-[64px]', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects/7/status') return Response.json({ status: 'stopped' }) as Response;
      if (u === '/api/projects') {
        return Response.json([{ id: 7, name: 'Alpha' }]) as Response;
      }
      return Response.json({}) as Response;
    };

    const { container } = render(
      TestWrapper({ children: React.createElement(MobileProjectList as any) })
    );
    await flush();

    const cardEl = container.querySelector('[data-testid="mobile-project-card"]') as HTMLElement;
    assert.ok(cardEl, 'card must render');
    assert.ok(cardEl.className.includes('min-h-[64px]'), 'card must be min-h-[64px]');

    const openLink = container.querySelector('button[aria-label="Open Alpha"]') as HTMLButtonElement;
    assert.ok(openLink, '"Open" action must render');
    assert.ok(openLink.className.includes('tap-target'), '"Open" action must use tap-target');

    // The card itself (article) must not introduce hover:* utility classes.
    // shadcn Button/Badge add hover:* from their variants; those are intentional
    // no-ops on touch and are present throughout the mobile app.
    const ownHoverClasses = (cardEl.className.match(/\bhover:[\w/:-]+/g) || []);
    assert.deepStrictEqual(
      ownHoverClasses,
      [],
      'mobile project card must not introduce hover:* utility classes itself'
    );
  });

  it('renders an empty state when there are no projects', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileProjectList as any) })
    );
    await flush();
    await flush();
    assert.ok(container.textContent?.includes('No projects yet'), 'empty state message must render');
  });

  it('shows the admin "New Project" button when authenticated as admin', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') {
        return Response.json({ user: { id: 1, username: 'admin', role: 'admin' } }) as Response;
      }
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileProjectList as any) })
    );
    await flush();
    await flush();
    assert.ok(container.textContent?.includes('New Project'), 'admin "New Project" button must render');
  });

  it('does NOT show the "New Project" button for non-admin users', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') {
        return Response.json({ user: { id: 2, username: 'guest', role: 'user' } }) as Response;
      }
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileProjectList as any) })
    );
    await flush();
    await flush();
    // The "Projects" heading is always rendered, so check for the admin button label
    // which appears only when isAdmin. Use a more specific selector:
    const buttons = Array.from(container.querySelectorAll('button'));
    const newProjectBtn = buttons.find((b) => b.textContent?.includes('New Project'));
    assert.strictEqual(newProjectBtn, undefined, '"New Project" button must not render for non-admin users');
  });
});
