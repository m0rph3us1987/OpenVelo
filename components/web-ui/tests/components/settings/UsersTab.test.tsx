import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { ToastProvider } from '@/context/ToastContext';
import { UsersTab } from '@/components/settings/UsersTab';

describe.skip('UsersTab', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('renders user list from API', async () => {
    global.fetch = async (url: unknown) => {
      if (String(url) === '/api/users') {
        return Response.json([
          { id: 1, username: 'alice', role: 'admin', enabled: true, password_reset_required: false },
          { id: 2, username: 'bob', role: 'user', enabled: false, password_reset_required: false },
        ]);
      }
      return Response.json({});
    };

    let html = '';
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        html = ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(UsersTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(html.includes('alice'));
    assert.ok(html.includes('bob'));
    assert.ok(html.includes('admin'));
    assert.ok(html.includes('user'));
  });

  it('create user dialog submits POST /api/users', async () => {
    const postCalls: { method: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s === '/api/users') {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        postCalls.push({ method, body });
        return Response.json({ id: 3, username: 'charlie', role: 'user', enabled: true });
      }
      return Response.json([]);
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(UsersTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(postCalls.some(c => c.method === 'POST' && c.body.includes('charlie')));
  });

  it('reset password dialog calls PUT /api/users/:id/password', async () => {
    const putCalls: { method: string; url: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s.match(/^\/api\/users\/\d+\/password$/)) {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        putCalls.push({ method, url: s, body });
        return Response.json({ newPassword: 'Gen!Pass1' });
      }
      if (s === '/api/users') {
        return Response.json([{ id: 1, username: 'alice', role: 'admin', enabled: true }]);
      }
      return Response.json({});
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(UsersTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(putCalls.some(c => c.method === 'PUT' && c.url.includes('/password')));
  });

  it('disable user calls PUT /api/users/:id', async () => {
    const putCalls: { method: string; url: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s.match(/^\/api\/users\/\d+$/) && !s.includes('/password')) {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        putCalls.push({ method, url: s, body });
        return Response.json({ id: 1, username: 'alice', enabled: false });
      }
      if (s === '/api/users') {
        return Response.json([{ id: 1, username: 'alice', role: 'admin', enabled: true }]);
      }
      return Response.json({});
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(UsersTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(putCalls.some(c => c.method === 'PUT' && c.url.endsWith('/api/users/1') && c.body.includes('enabled')));
  });
});