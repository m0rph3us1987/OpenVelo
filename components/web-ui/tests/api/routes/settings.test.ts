import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb, resetTestDb, closeDb, createUser, setUiSetting } from '@/lib/db';
import { settingsRouter } from '@/api/routes/settings';
import supertest from 'supertest';
import { signJwt } from '@/lib/auth';
import { getSessionSecret } from '@/lib/session';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      password_reset_required INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

describe('settings routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let secret: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    initDb();
    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);
    secret = getSessionSecret();
  });

  after(() => {
    closeDb();
  });

  describe('GET /api/settings', () => {
    it('returns securityEnabled for all requests', async () => {
      setUiSetting('security_enabled', 'true');
      const request = supertest(app);
      const res = await request.get('/api/settings');
      assert.strictEqual(res.status, 200);
      assert.ok('securityEnabled' in res.body);
    });

    it('returns default securityEnabled false', async () => {
      setUiSetting('security_enabled', 'false');
      const request = supertest(app);
      const res = await request.get('/api/settings');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.securityEnabled, false);
    });
  });

  describe('PUT /api/settings', () => {
    it('updates appTitle without auth', async () => {
      setUiSetting('security_enabled', 'false');
      const request = supertest(app);
      const res = await request.put('/api/settings').send({ appTitle: 'My App' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.appTitle, 'My App');
    });

    it('rejects securityEnabled toggle by non-admin with 403', async () => {
      setUiSetting('security_enabled', 'true');
      const hash = await import('bcryptjs').then(m => m.hashSync('password123', 10));
      createUser({ username: 'user1', password_hash: hash, role: 'user', enabled: true, password_reset_required: false });
      const token = await signJwt({ userId: 1, username: 'user1', role: 'user' }, secret);

      const testApp = express();
      testApp.use(express.json());

      function setUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
        req.user = { id: 1, username: 'user1', role: 'user', password_hash: hash } as express.Request['user'];
        next();
      }

      testApp.use('/api/settings', setUser, settingsRouter);
      const request = supertest(testApp);
      const res = await request.put('/api/settings').set('Cookie', `openvelo-token=${token}`).send({ securityEnabled: false });
      assert.strictEqual(res.status, 403);
    });

    it('rejects enabling security when no admin exists with 400', async () => {
      setUiSetting('security_enabled', 'false');
      const hash = await import('bcryptjs').then(m => m.hashSync('password123', 10));
      createUser({ username: 'admin1', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });
      const token = await signJwt({ userId: 1, username: 'admin1', role: 'admin' }, secret);

      const testApp = express();
      testApp.use(express.json());

      function setUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
        req.user = { id: 1, username: 'admin1', role: 'admin', password_hash: hash } as express.Request['user'];
        next();
      }

      testApp.use('/api/settings', setUser, settingsRouter);
      const request = supertest(testApp);
      const res = await request.put('/api/settings').set('Cookie', `openvelo-token=${token}`).send({ securityEnabled: true });
      assert.strictEqual(res.status, 200);
    });

    it('rejects enabling security when no admin exists with 400 (no admins)', async () => {
      setUiSetting('security_enabled', 'false');
      const hash = await import('bcryptjs').then(m => m.hashSync('password123', 10));
      createUser({ username: 'admin1', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });
      const token = await signJwt({ userId: 1, username: 'admin1', role: 'admin' }, secret);

      const testApp = express();
      testApp.use(express.json());

      function setUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
        req.user = { id: 1, username: 'admin1', role: 'admin', password_hash: hash } as express.Request['user'];
        next();
      }

      testApp.use('/api/settings', setUser, settingsRouter);
      const request = supertest(testApp);

      db.prepare('UPDATE users SET enabled = 0 WHERE id = 1').run({});

      const res = await request.put('/api/settings').set('Cookie', `openvelo-token=${token}`).send({ securityEnabled: true });
      assert.strictEqual(res.status, 400);
    });

    it('allows admin to toggle securityEnabled', async () => {
      setUiSetting('security_enabled', 'false');
      const hash = await import('bcryptjs').then(m => m.hashSync('password123', 10));
      createUser({ username: 'admin1', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });
      const token = await signJwt({ userId: 1, username: 'admin1', role: 'admin' }, secret);

      const testApp = express();
      testApp.use(express.json());

      function setUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
        req.user = { id: 1, username: 'admin1', role: 'admin', password_hash: hash } as express.Request['user'];
        next();
      }

      testApp.use('/api/settings', setUser, settingsRouter);
      const request = supertest(testApp);
      const res = await request.put('/api/settings').set('Cookie', `openvelo-token=${token}`).send({ securityEnabled: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.securityEnabled, true);
    });
  });
});