import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';

describe('ChangePasswordPage', () => {
  it('renders form with current password, new password, and confirm password fields', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = async (url: unknown) => {
        const s = String(url);
        if (s.includes('/api/auth/me')) {
          return Response.json({ id: 1, username: 'alice', role: 'admin' });
        }
        return Response.json({});
      };

      let html = '';
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          html = ReactDOMServer.renderToString(
            <MemoryRouter>
              <ChangePasswordPage />
            </MemoryRouter>
          );
          resolve();
        }, 100);
      });

      assert.ok(html.includes('Current Password'), 'Expected current password field');
      assert.ok(html.includes('New Password'), 'Expected new password field');
      assert.ok(html.includes('Confirm'), 'Expected confirm password field');
      assert.ok(html.includes('Update Password'), 'Expected Update Password button');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('renders Change Password title and form inputs', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = async (url: unknown) => {
        const s = String(url);
        if (s.includes('/api/auth/me')) {
          return Response.json({ id: 1, username: 'alice', role: 'admin' });
        }
        return Response.json({});
      };

      let html = '';
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          html = ReactDOMServer.renderToString(
            <MemoryRouter>
              <ChangePasswordPage />
            </MemoryRouter>
          );
          resolve();
        }, 100);
      });

      assert.ok(html.includes('Change Password'), 'Expected Change Password title');
      assert.ok(html.includes('id="currentPassword"'), 'Expected current password input');
      assert.ok(html.includes('id="newPassword"'), 'Expected new password input');
      assert.ok(html.includes('id="confirmPassword"'), 'Expected confirm password input');
    } finally {
      global.fetch = origFetch;
    }
  });
});