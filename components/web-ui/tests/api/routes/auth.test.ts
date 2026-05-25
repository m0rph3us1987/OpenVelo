import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb, resetTestDb, closeDb, createUser, setUiSetting } from '@/lib/db';
import { authRouter } from '@/api/routes/auth';
import supertest from 'supertest';

describe('auth routes', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
  });

  after(() => {
    closeDb();
  });

  describe('POST /api/auth/login', () => {
    it('returns 400 when security is disabled', async () => {
      setUiSetting('security_enabled', 'false');
      const request = supertest(app);
      const res = await request.post('/api/auth/login').send({ username: 'admin', password: 'pass' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 401 for invalid credentials', async () => {
      setUiSetting('security_enabled', 'true');
      const request = supertest(app);
      const res = await request.post('/api/auth/login').send({ username: 'nonexistent', password: 'wrong' });
      assert.strictEqual(res.status, 401);
    });

    it('returns user and sets cookie on valid login', async () => {
      setUiSetting('security_enabled', 'true');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('password123', 10);
      createUser({ username: 'testuser', password_hash: hash, role: 'user', enabled: true, password_reset_required: false });

      const request = supertest(app);
      const res = await request.post('/api/auth/login').send({ username: 'testuser', password: 'password123' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['set-cookie']);
      assert.strictEqual(res.body.user.username, 'testuser');
      assert.strictEqual(res.body.resetRequired, false);
    });

    it('returns resetRequired true when flag is set', async () => {
      setUiSetting('security_enabled', 'true');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('password123', 10);
      createUser({ username: 'resetuser', password_hash: hash, role: 'user', enabled: true, password_reset_required: true });

      const request = supertest(app);
      const res = await request.post('/api/auth/login').send({ username: 'resetuser', password: 'password123' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.resetRequired, true);
    });
  });

  describe('DELETE /api/auth/logout', () => {
    it('clears cookie and returns ok', async () => {
      const request = supertest(app);
      const res = await request.delete('/api/auth/logout');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns synthetic admin when security is disabled', async () => {
      setUiSetting('security_enabled', 'false');
      const request = supertest(app);
      const res = await request.get('/api/auth/me');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.username, 'system');
      assert.strictEqual(res.body.user.role, 'admin');
    });

    it('returns 401 when security enabled and no cookie', async () => {
      setUiSetting('security_enabled', 'true');
      const request = supertest(app);
      const res = await request.get('/api/auth/me');
      assert.strictEqual(res.status, 401);
    });

    it('returns user when authenticated', async () => {
      setUiSetting('security_enabled', 'true');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('password123', 10);
      createUser({ username: 'authuser', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });

      const agent = supertest(app);
      const loginRes = await agent.post('/api/auth/login').send({ username: 'authuser', password: 'password123' });
      assert.strictEqual(loginRes.status, 200);
      const cookieHeader = loginRes.headers['set-cookie'];
      assert.ok(cookieHeader, 'Cookie should be set on login');

      const cookieValue = Array.isArray(cookieHeader)
        ? cookieHeader.find(c => c.startsWith('openvelo-token='))?.split(';')[0]
        : String(cookieHeader).split(';')[0];

      const res = await agent.get('/api/auth/me').set('Cookie', cookieValue);
      assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}. Body: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.user.username, 'authuser');
    });
  });
});