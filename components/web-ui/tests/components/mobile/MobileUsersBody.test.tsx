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
import { MobileUsersTab } from '@/components/mobile/MobileUsersBody';

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

describe('MobileUsersTab', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('renders the user list with tap-target controls', async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u === '/api/users') {
        return Response.json([
          { id: 1, username: 'alice', role: 'admin', enabled: true, password_reset_required: false },
        ]) as Response;
      }
      return Response.json({}) as Response;
    }) as typeof fetch;

    const { container } = render(
      TestWrapper({ children: React.createElement(MobileUsersTab) })
    );
    await flush();
    const text = container.textContent || '';
    assert.ok(text.includes('alice'), 'username must render in the list');
    const editBtn = container.querySelector('button[aria-label="Edit alice"]') as HTMLButtonElement;
    assert.ok(editBtn, 'Edit button must render');
    assert.ok(editBtn.className.includes('tap-target'), 'Edit button must have tap-target class');
    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create user'
    ) as HTMLButtonElement | undefined;
    assert.ok(createBtn, 'Create user button must render');
    assert.ok(createBtn.className.includes('tap-target'), 'Create user button must have tap-target class');
  });

  it('opens the create-user sheet when Create user is tapped', async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u === '/api/users') return Response.json([]) as Response;
      return Response.json({}) as Response;
    }) as typeof fetch;

    const { container } = render(
      TestWrapper({ children: React.createElement(MobileUsersTab) })
    );
    await flush();
    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create user'
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(createBtn);
    });
    await flush();
    const usernameInput = container.querySelector('#mobile-create-username') as HTMLInputElement;
    const passwordInput = container.querySelector('#mobile-create-password') as HTMLInputElement;
    assert.ok(usernameInput, 'create-user sheet must render the username input');
    assert.ok(passwordInput, 'create-user sheet must render the password input');
    assert.ok(usernameInput.className.includes('tap-target'), 'username input must be tap-target');
    assert.ok(passwordInput.className.includes('tap-target'), 'password input must be tap-target');
  });
});
