import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';

describe('LoginPage', () => {
  it('renders username and password form when securityEnabled is true', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = async (url: unknown) => {
        const s = String(url);
        if (s.includes('/api/settings')) {
          return Response.json({ securityEnabled: true });
        }
        return Response.json({});
      };

      let html = '';
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          html = ReactDOMServer.renderToString(
            <MemoryRouter>
              <LoginPage />
            </MemoryRouter>
          );
          resolve();
        }, 100);
      });

      assert.ok(html.includes('Username'), 'Expected username field in output');
      assert.ok(html.includes('Password'), 'Expected password field in output');
      assert.ok(html.includes('Sign In'), 'Expected Sign In button in output');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('renders Sign In title and credential inputs', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = async (url: unknown) => {
        const s = String(url);
        if (s.includes('/api/settings')) {
          return Response.json({ securityEnabled: true });
        }
        return Response.json({});
      };

      let html = '';
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          html = ReactDOMServer.renderToString(
            <MemoryRouter>
              <LoginPage />
            </MemoryRouter>
          );
          resolve();
        }, 100);
      });

      assert.ok(html.includes('Sign In'), 'Expected Sign In title');
      assert.ok(html.includes('id="username"'), 'Expected username input');
      assert.ok(html.includes('id="password"'), 'Expected password input');
    } finally {
      global.fetch = origFetch;
    }
  });
});