import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb, resetTestDb, closeDb, createUser, setUiSetting } from '@/lib/db';
import { usersRouter } from '@/api/routes/users';
import { authRouter } from '@/api/routes/auth';
import supertest from 'supertest';

describe('users routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = new Database(':memory:');
    resetTestDb(db);
    initDb();
    setUiSetting('security_enabled', 'true');
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/users', usersRouter);
  });

  after(() => {
    closeDb();
  });

  async function getAdminCookie(agent: supertest.SuperagentTest): Promise<string> {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Admin123!', 10);
    createUser({ username: 'admin', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });
    const loginRes = await agent.post('/api/auth/login').send({ username: 'admin', password: 'Admin123!' });
    const cookieHeader = loginRes.headers['set-cookie'];
    const cookieValue = Array.isArray(cookieHeader)
      ? cookieHeader.find(c => c.startsWith('openvelo-token='))?.split(';')[0]
      : String(cookieHeader).split(';')[0];
    return cookieValue ?? '';
  }

  describe('POST /api/users', () => {
    it('creates user with valid password', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const res = await agent.post('/api/users').set('Cookie', cookie).send({ username: 'newuser', password: 'Valid123!', role: 'user' });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.username, 'newuser');
      assert.strictEqual(res.body.role, 'user');
      assert.strictEqual(res.body.password_hash, undefined);
    });

    it('rejects duplicate username', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('Existing123!', 10);
      createUser({ username: 'existing', password_hash: hash, role: 'user', enabled: true, password_reset_required: false });

      const res = await agent.post('/api/users').set('Cookie', cookie).send({ username: 'EXISTING', password: 'Valid123!', role: 'user' });
      assert.strictEqual(res.status, 409);
    });

    it('rejects weak password', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const res = await agent.post('/api/users').set('Cookie', cookie).send({ username: 'weakuser', password: 'weak', role: 'user' });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('PUT /api/users/:id', () => {
    it('prevents disabling the last admin', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const res = await agent.put('/api/users/1').set('Cookie', cookie).send({ enabled: false });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('PUT /api/users/:id/password', () => {
    it('admin can reset password', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      createUser({ username: 'target', password_hash: await bcrypt.hash('Target123!', 10), role: 'user', enabled: true, password_reset_required: false });

      const res = await agent.put('/api/users/2/password').set('Cookie', cookie).send({ newPassword: 'NewPass123!' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.newPassword);
    });
  });

  describe('PUT /api/users/me/password', () => {
    it('user can change own password with correct current password', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const res = await agent.put('/api/users/me/password').set('Cookie', cookie).send({ currentPassword: 'Admin123!', newPassword: 'NewAdmin456!' });
      assert.strictEqual(res.status, 200);
    });

    it('rejects self-change with wrong current password', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const res = await agent.put('/api/users/me/password').set('Cookie', cookie).send({ currentPassword: 'WrongPass1!', newPassword: 'NewAdmin456!' });
      assert.strictEqual(res.status, 403);
    });
  });
});