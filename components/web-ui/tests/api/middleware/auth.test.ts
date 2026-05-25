import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb, setUiSetting } from '@/lib/db';
import { requireAuth, requireAdmin } from '@/api/middleware/auth';
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

describe('requireAuth', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
  });

  after(() => {
    closeDb();
  });

  it('sets synthetic admin when security_enabled is false', () => {
    setUiSetting('security_enabled', 'false');

    let userAssigned: Record<string, unknown> | null = null;
    let nextCalled = false;

    const mockReq = { headers: {} };
    const mockRes = {};
    const mockNext = () => { nextCalled = true; };
    Object.defineProperty(mockReq, 'user', {
      set: (v) => { userAssigned = v; },
      get: () => userAssigned,
      configurable: true
    });

    requireAuth(mockReq as never, mockRes as never, mockNext);

    assert.strictEqual(nextCalled, true);
    assert.ok(userAssigned !== null);
  });

  it('returns 401 for missing cookie when security enabled', () => {
    setUiSetting('security_enabled', 'true');

    let statusCode = 0;
    let responseBody: unknown = null;

    const mockReq = { headers: {} };
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: (msg: unknown) => { responseBody = msg; return mockRes; }
    };
    const mockNext = () => {};

    requireAuth(mockReq as never, mockRes as never, mockNext);

    assert.strictEqual(statusCode, 401);
    assert.deepStrictEqual(responseBody, { error: 'Unauthorized' });
  });

  it('returns 401 when user not found', () => {
    setUiSetting('security_enabled', 'true');

    let statusCode = 0;

    const mockReq = { headers: { cookie: 'openvelo-token=invalidtoken' } };
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: () => {}
    };
    const mockNext = () => {};

    requireAuth(mockReq as never, mockRes as never, mockNext);

    setTimeout(() => {
      assert.strictEqual(statusCode, 401);
    }, 50);
  });

  it('returns 401 when user is disabled', async () => {
    setUiSetting('security_enabled', 'true');
    db.prepare(`INSERT INTO users (username, password_hash, role, enabled) VALUES ('testuser', 'hash', 'user', 0)`).run({});

    const secret = getSessionSecret();
    const token = await signJwt({ userId: 1, username: 'testuser', role: 'user' }, secret);

    let statusCode = 0;

    const mockReq = { headers: { cookie: `openvelo-token=${token}` } };
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: () => {}
    };
    const mockNext = () => {};

    requireAuth(mockReq as never, mockRes as never, mockNext);

    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(statusCode, 401);
  });
});

describe('requireAdmin', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
  });

  after(() => {
    closeDb();
  });

  it('returns 403 for non-admin user when security enabled', async () => {
    setUiSetting('security_enabled', 'true');
    const result = db.prepare(`INSERT INTO users (username, password_hash, role, enabled) VALUES ('regular', 'hash', 'user', 1)`).run({});
    const userId = result.lastInsertRowid as number;

    const secret = getSessionSecret();
    const token = await signJwt({ userId, username: 'regular', role: 'user' }, secret);

    let statusCode = 0;
    let responseBody: unknown = null;

    const mockReq = { headers: { cookie: `openvelo-token=${token}` } };
    const mockRes = {
      status: (code: number) => { statusCode = code; return mockRes; },
      json: (msg: unknown) => { responseBody = msg; return mockRes; }
    };
    const mockNext = () => {};

    requireAdmin(mockReq as never, mockRes as never, mockNext);

    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(statusCode, 403);
    assert.deepStrictEqual(responseBody, { error: 'Forbidden' });
  });
});