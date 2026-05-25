import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { ToastProvider } from '@/context/ToastContext';
import { GroupsTab } from '@/components/settings/GroupsTab';

describe.skip('GroupsTab', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('renders group list from API', async () => {
    global.fetch = async (url: unknown) => {
      const s = String(url);
      if (s === '/api/groups') {
        return Response.json([
          { id: 1, name: 'Group A', description: 'Desc A', members: [{ id: 1, username: 'alice' }], projects: [{ id: 1, name: 'Proj A' }] },
          { id: 2, name: 'Group B', description: '', members: [], projects: [] },
        ]);
      }
      if (s === '/api/users') {
        return Response.json([{ id: 1, username: 'alice', role: 'user', enabled: true, password_reset_required: false }]);
      }
      if (s === '/api/projects') {
        return Response.json([{ id: 1, name: 'Proj A' }]);
      }
      return Response.json({});
    };

    let html = '';
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        html = ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(GroupsTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(html.includes('Group A'));
    assert.ok(html.includes('Group B'));
    assert.ok(html.includes('Desc A'));
  });

  it('create group submits POST /api/groups with users and projects', async () => {
    const postCalls: { method: string; url: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s === '/api/groups') {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        postCalls.push({ method, url: s, body });
        return Response.json({ id: 3, name: 'New Group' });
      }
      if (s === '/api/users') {
        return Response.json([{ id: 1, username: 'alice', role: 'user', enabled: true, password_reset_required: false }]);
      }
      if (s === '/api/projects') {
        return Response.json([{ id: 1, name: 'Proj A' }]);
      }
      return Response.json([]);
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(GroupsTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(postCalls.some(c => c.method === 'POST' && c.url === '/api/groups'));
  });

  it('edit group calls PUT /api/groups/:id', async () => {
    const putCalls: { method: string; url: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s === '/api/groups') {
        return Response.json([{ id: 1, name: 'Existing', description: '', members: [], projects: [] }]);
      }
      if (s.match(/^\/api\/groups\/\d+$/)) {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        putCalls.push({ method, url: s, body });
        return Response.json({ id: 1, name: 'Updated' });
      }
      if (s === '/api/users') {
        return Response.json([{ id: 1, username: 'alice', role: 'user', enabled: true, password_reset_required: false }]);
      }
      if (s === '/api/projects') {
        return Response.json([{ id: 1, name: 'Proj A' }]);
      }
      return Response.json({});
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(GroupsTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(putCalls.some(c => c.method === 'PUT' && c.url.match(/^\/api\/groups\/\d+$/)));
  });

  it('delete group calls DELETE /api/groups/:id after confirmation', async () => {
    const deleteCalls: { method: string; url: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s === '/api/groups') {
        return Response.json([{ id: 99, name: 'ToDelete', description: '', members: [], projects: [] }]);
      }
      if (s.match(/^\/api\/groups\/\d+$/)) {
        const method = (opts as { method?: string })?.method ?? 'GET';
        deleteCalls.push({ method, url: s });
        return Response.json({});
      }
      if (s === '/api/users') {
        return Response.json([]);
      }
      if (s === '/api/projects') {
        return Response.json([]);
      }
      return Response.json({});
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ReactDOMServer.renderToString(
          React.createElement(ToastProvider, null,
            React.createElement(GroupsTab)
          )
        );
        resolve();
      }, 100);
    });

    assert.ok(deleteCalls.some(c => c.method === 'DELETE' && c.url.match(/^\/api\/groups\/\d+$/)));
  });
});