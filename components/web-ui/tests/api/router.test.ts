import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { resetTestDb, closeDb, setUiSetting } from '@/lib/db';
import { signJwt } from '@/lib/auth';
import { getSessionSecret } from '@/lib/session';
import { apiRouter } from '@/api/router';

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

function makeGetRequest(app: express.Application, path: string, cookie?: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }
      const port = addr.port;
      const opts = {
        hostname: 'localhost',
        port,
        path,
        method: 'GET',
        headers: cookie ? { cookie } : {}
      };
      const req = http.request(opts, (res) => {
        server.close();
        resolve({ status: res.statusCode ?? 0 });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

function makePostRequest(app: express.Application, path: string, body: unknown, cookie?: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }
      const port = addr.port;
      const bodyStr = JSON.stringify(body);
      const opts = {
        hostname: 'localhost',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...(cookie ? { cookie } : {})
        }
      };
      const req = http.request(opts, (res) => {
        server.close();
        resolve({ status: res.statusCode ?? 0 });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.write(bodyStr);
      req.end();
    });
  });
}

describe('apiRouter', () => {
  let db: Database.Database;
  let app: express.Application;
  let secret: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    secret = getSessionSecret();
  });

  after(() => {
    closeDb();
  });

  it('GET /api/settings returns 200 without auth', async () => {
    setUiSetting('security_enabled', 'true');
    const res = await makeGetRequest(app, '/api/settings');
    assert.strictEqual(res.status, 200);
  });

  it('POST /api/auth/login returns 200 without auth', async () => {
    setUiSetting('security_enabled', 'true');
    const hash = bcrypt.hashSync('password123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, role, enabled) VALUES ('testuser', '${hash}', 'user', 1)`).run({});
    const res = await makePostRequest(app, '/api/auth/login', { username: 'testuser', password: 'password123' });
    assert.strictEqual(res.status, 200);
  });

  it('GET /api/projects returns 401 without auth', async () => {
    setUiSetting('security_enabled', 'true');
    const res = await makeGetRequest(app, '/api/projects');
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/users returns 403 for a regular-user JWT', async () => {
    setUiSetting('security_enabled', 'true');
    const result = db.prepare(`INSERT INTO users (username, password_hash, role, enabled) VALUES ('regular', 'hash', 'user', 1)`).run({});
    const userId = result.lastInsertRowid as number;
    const token = await signJwt({ userId, username: 'regular', role: 'user' }, secret);
    const res = await makeGetRequest(app, '/api/users', `openvelo-token=${token}`);
    assert.strictEqual(res.status, 403);
  });

  it('GET /api/users returns 401 without any token', async () => {
    setUiSetting('security_enabled', 'true');
    const res = await makeGetRequest(app, '/api/users');
    assert.strictEqual(res.status, 401);
  });
});