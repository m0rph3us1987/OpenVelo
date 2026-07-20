import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { Header } from '@/components/layout/Header';

function setupDOM() {
  const window = new Window();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
    writable: true,
  });
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

describe('Header', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('settings button visible for admin', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/auth/me') {
        return Response.json({ id: 1, username: 'admin', role: 'admin' });
      }
      if (String(url) === '/api/settings') {
        return Response.json({});
      }
      if (String(url) === '/api/themes') {
        return Response.json([]);
      }
      if (String(url) === '/api/themes/dark') {
        return Response.json({ colors: {} });
      }
      return Response.json({});
    };
    const { container } = render(TestWrapper({ children: React.createElement(Header) }));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.ok(container.innerHTML.includes('Open settings'));
  });

  it('settings button hidden for non-admin when security enabled', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/auth/me') {
        return Response.json({ id: 2, username: 'bob', role: 'user' });
      }
      if (String(url) === '/api/settings') {
        return Response.json({ securityEnabled: true });
      }
      if (String(url) === '/api/themes') {
        return Response.json([]);
      }
      if (String(url) === '/api/themes/dark') {
        return Response.json({ colors: {} });
      }
      return Response.json({});
    };
    const { container } = render(TestWrapper({ children: React.createElement(Header) }));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.ok(!container.innerHTML.includes('Open settings'));
  });

  it('profile dropdown shows username', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/auth/me') {
        return Response.json({ user: { id: 1, username: 'alice', role: 'admin' } });
      }
      if (String(url) === '/api/settings') {
        return Response.json({ securityEnabled: true });
      }
      if (String(url) === '/api/themes') {
        return Response.json([]);
      }
      if (String(url) === '/api/themes/dark') {
        return Response.json({ colors: {} });
      }
      return Response.json({});
    };
    const { container } = render(TestWrapper({ children: React.createElement(Header) }));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.ok(container.innerHTML.includes('alice'));
  });

  it('profile dropdown is hidden when security is disabled', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/auth/me') {
        return Response.json({ user: { id: 3, username: 'carol', role: 'admin' } });
      }
      if (String(url) === '/api/settings') {
        return Response.json({ securityEnabled: false });
      }
      if (String(url) === '/api/themes') {
        return Response.json([]);
      }
      if (String(url) === '/api/themes/dark') {
        return Response.json({ colors: {} });
      }
      return Response.json({});
    };
    const { container } = render(TestWrapper({ children: React.createElement(Header) }));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.ok(!container.innerHTML.includes('carol'), 'username must NOT render when security is disabled');
  });

  it('dropdown contains Change Password and Log out', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/auth/me') {
        return Response.json({ user: { id: 1, username: 'alice', role: 'admin' } });
      }
      if (String(url) === '/api/settings') {
        return Response.json({ securityEnabled: true });
      }
      if (String(url) === '/api/themes') {
        return Response.json([]);
      }
      if (String(url) === '/api/themes/dark') {
        return Response.json({ colors: {} });
      }
      return Response.json({});
    };
    const { container } = render(TestWrapper({ children: React.createElement(Header) }));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const userButton = container.querySelector('button');
    assert.ok(userButton);
    fireEvent.click(userButton);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    assert.ok(container.innerHTML.includes('Change Password'));
    assert.ok(container.innerHTML.includes('Log out'));
  });
});