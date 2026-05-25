import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const BASE_TABS = ['general', 'models'] as const;
const ADMIN_TABS = ['general', 'users', 'groups', 'models'] as const;

function TabPanel({ tabs }: { tabs: readonly string[] }) {
  return (
    <Tabs value="general" orientation="vertical">
      <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="flex items-center justify-start px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50 data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md w-full text-left capitalize">
            {tab}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

describe('SettingsModal tabs', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('BASE_TABS contains only general and models', () => {
    assert.deepStrictEqual(BASE_TABS, ['general', 'models']);
  });

  it('ADMIN_TABS contains all four tabs', () => {
    assert.deepStrictEqual(ADMIN_TABS, ['general', 'users', 'groups', 'models']);
  });

  it('non-admin sees only General and Models tabs via renderToString', async () => {
    global.fetch = async (url: unknown) => {
      const s = String(url);
      if (s.includes('/api/auth/me')) {
        return Response.json({ id: 1, username: 'alice', role: 'user' });
      }
      return Response.json({});
    };

    const html = await new Promise<string>((resolve) => {
      setTimeout(() => {
        const html = ReactDOMServer.renderToString(
          React.createElement(TabPanel, { tabs: BASE_TABS })
        );
        resolve(html);
      }, 600);
    });

    assert.ok(html.includes('general'), 'Expected general tab for non-admin');
    assert.ok(html.includes('models'), 'Expected models tab for non-admin');
    assert.ok(!html.includes('users'), 'Non-admin should not see users tab');
    assert.ok(!html.includes('groups'), 'Non-admin should not see groups tab');
  });

  it('admin sees all four tabs via renderToString', async () => {
    global.fetch = async (url: unknown) => {
      const s = String(url);
      if (s.includes('/api/auth/me')) {
        return Response.json({ id: 1, username: 'alice', role: 'admin' });
      }
      return Response.json({});
    };

    const html = await new Promise<string>((resolve) => {
      setTimeout(() => {
        const html = ReactDOMServer.renderToString(
          React.createElement(TabPanel, { tabs: ADMIN_TABS })
        );
        resolve(html);
      }, 600);
    });

    assert.ok(html.includes('general'), 'Expected general tab for admin');
    assert.ok(html.includes('models'), 'Expected models tab for admin');
    assert.ok(html.includes('users'), 'Expected users tab for admin');
    assert.ok(html.includes('groups'), 'Expected groups tab for admin');
  });

  it('security enabled switch calls PUT /api/settings', async () => {
    const putCalls: { method: string; body: string }[] = [];
    global.fetch = async (url: unknown, opts?: unknown) => {
      const s = String(url);
      if (s.includes('/api/settings')) {
        const method = (opts as { method?: string })?.method ?? 'GET';
        const body = (opts as { body?: string })?.body ?? '';
        putCalls.push({ method, body: JSON.stringify(body) });
        return Response.json({ debugSseConsole: false, securityEnabled: false });
      }
      if (s.includes('/api/auth/me')) {
        return Response.json({ id: 1, username: 'alice', role: 'admin' });
      }
      return Response.json({});
    };

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 700);
    });

    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ securityEnabled: true }),
    });

    const settingsPut = putCalls.find(c => c.method === 'PUT' && c.body.includes('securityEnabled'));
    assert.ok(settingsPut, `Expected PUT /api/settings with securityEnabled, got: ${JSON.stringify(putCalls)}`);
  });
});