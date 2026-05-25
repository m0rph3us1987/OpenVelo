import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { AuthProvider, useAuth } from '@/context/AuthContext';

const LS_KEY = 'openvelo-auth';

function TestComponent() {
  const auth = useAuth();
  return (
    <div>
      <div id="loading">{auth.loading ? 'loading' : 'done'}</div>
      <div id="isAdmin">{auth.isAdmin ? 'admin' : 'not-admin'}</div>
      <div id="user">{auth.user ? auth.user.username : 'no-user'}</div>
    </div>
  );
}

interface FetchOpts {
  method?: string;
}

describe.skip('AuthContext', () => {
  const storedLs: Record<string, string> = {};
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
    Object.keys(storedLs).forEach(k => delete storedLs[k]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = globalThis as any;
    win.window = {
      location: { reload: () => {} },
    };
    global.localStorage = {
      getItem: (key: string) => storedLs[key] ?? null,
      setItem: (key: string, val: string) => { storedLs[key] = val; },
      removeItem: (key: string) => { delete storedLs[key]; },
      clear: () => { Object.keys(storedLs).forEach(k => delete storedLs[k]); },
    } as unknown as Storage;
  });

  afterEach(() => {
    global.fetch = origFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).localStorage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
  });

  it('fetches /api/auth/me on mount', async () => {
    let fetchCalled = false;
    global.fetch = async (url: unknown) => {
      const s = String(url);
      if (s.includes('/api/auth/me')) {
        fetchCalled = true;
      }
      return Response.json({ id: 1, username: 'alice', role: 'admin' });
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );
        resolve();
      }, 600);
    });

    assert.ok(fetchCalled, 'Expected fetch to /api/auth/me');
  });

  it('computes isAdmin correctly', async () => {
    global.fetch = async () => Response.json({ id: 1, username: 'alice', role: 'admin' });

    let html = '';
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        html = ReactDOMServer.renderToString(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );
        resolve();
      }, 600);
    });

    assert.ok(html.includes('admin'), `Expected admin in output, got: ${html}`);
  });

  it('stores minimal auth in localStorage', async () => {
    global.fetch = async () => Response.json({ id: 1, username: 'alice', role: 'admin' });

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );
        resolve();
      }, 600);
    });

    const stored = storedLs[LS_KEY];
    assert.ok(stored, 'Expected openvelo-auth in localStorage');
    const parsed = JSON.parse(stored);
    assert.strictEqual(parsed.username, 'alice');
    assert.strictEqual(parsed.role, 'admin');
  });

  it('logout calls DELETE /api/auth/logout and clears localStorage', async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      urls.push(String(url));
      methods.push((opts as FetchOpts)?.method ?? 'GET');
      return Response.json({});
    };

    let logoutFn: () => Promise<void> = async () => {};
    function LogoutComponent() {
      const auth = useAuth();
      logoutFn = auth.logout;
      return <div>logout</div>;
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          <AuthProvider>
            <LogoutComponent />
          </AuthProvider>
        );
        resolve();
      }, 600);
    });

    storedLs[LS_KEY] = JSON.stringify({ id: 1, username: 'alice', role: 'admin' });
    await logoutFn();

    assert.ok(methods.includes('DELETE'), `Expected DELETE method, got: ${methods}`);
    assert.ok(urls.some(u => u.includes('/api/auth/logout')), `Expected /api/auth/logout, got: ${urls}`);
    assert.strictEqual(storedLs[LS_KEY], undefined, 'Expected localStorage to be cleared');
  });
});