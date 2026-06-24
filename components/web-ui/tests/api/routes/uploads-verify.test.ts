import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'assert';
import express from 'express';
import Database from 'better-sqlite3';
import supertest from 'supertest';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { resetTestDb, closeDb } from '@/lib/db';
import { uploadRouter } from '@/api/routes/uploads';
import type { User } from '@/lib/types';
import { signJwt } from '@/lib/auth';
import { getSessionSecret } from '@/lib/session';
import { serveRegistry } from '@/lib/opencode-serve-registry';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
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
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      port INTEGER NOT NULL DEFAULT 3000,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'opencode',
      default_model TEXT NOT NULL DEFAULT '',
      execution_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT '',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      build_cmd TEXT,
      test_cmd TEXT,
      staging_branch TEXT NOT NULL DEFAULT 'staging',
      poll_interval INTEGER NOT NULL DEFAULT 60000,
      agent_max_timeout INTEGER NOT NULL DEFAULT 300,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO projects (id, name, port, repo_url) VALUES (1, 'Test Project', 3001, 'https://github.com/test/repo');
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, provider)
    );
    INSERT OR IGNORE INTO models (project_id, provider, model_name) VALUES (1, 'openai', 'gpt-4');
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify', 'requirement')),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'init',
      sub_stage TEXT NOT NULL DEFAULT '',
      sub_stage_pre_error TEXT NOT NULL DEFAULT '',
      error_type TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function buildApp(user: User | null, uploadMiddleware: multer.Multer) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user ?? undefined;
    next();
  });
  app.set('upload', uploadMiddleware);
  app.use('/api/uploads', uploadRouter);
  return app;
}

function createVerifyChat(db: Database.Database, id: number, projectId: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
    VALUES (?, 'verify', ?, 'Verify Chat', 'verify', 'upload')
  `).run(id, projectId);
}

describe('uploadOldRequirement endpoint', () => {
  let db: Database.Database;
  let app: express.Express;
  let upload: multer.Multer;
  const adminUser: User = { id: 1, username: 'admin', role: 'admin', enabled: true } as User;
  const nonAdminUser: User = { id: 2, username: 'user', role: 'user', enabled: true } as User;
  const tempDirs: string[] = [];
  const originalSetImmediate = globalThis.setImmediate;
  const pendingCallbacks: Array<() => void> = [];

  beforeEach(() => {
    pendingCallbacks.length = 0;
    globalThis.setImmediate = ((fn: (...args: unknown[]) => unknown) => {
      pendingCallbacks.push(fn as () => void);
      return originalSetImmediate(fn as Parameters<typeof setImmediate>[0]);
    }) as typeof setImmediate;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
    app = buildApp(adminUser, upload);
  });

  afterEach(() => {
    let prevLength = 0;
    while (pendingCallbacks.length !== prevLength) {
      prevLength = pendingCallbacks.length;
      const callbacks = pendingCallbacks.splice(0);
      for (const cb of callbacks) {
        cb();
      }
    }
    pendingCallbacks.length = 0;
    globalThis.setImmediate = originalSetImmediate;
    serveRegistry.shutdownAll();
    for (const dir of tempDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('POST /api/uploads/uploadOldRequirement without chatId returns 400', async () => {
    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .attach('file', Buffer.from('some content'), { filename: 'test.md' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'chatId and file are required' });
  });

  it('POST /api/uploads/uploadOldRequirement with non-existent chatId returns 404', async () => {
    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '9999')
      .attach('file', Buffer.from('some content'), { filename: 'test.md' });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'Chat session not found' });
  });

  it('POST /api/uploads/uploadOldRequirement with wrong stage returns 400', async () => {
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Wrong Stage Chat', 'init', '')
    `).run();

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('some content'), { filename: 'test.md' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'Chat is not in the upload phase' });
  });

  it('POST /api/uploads/uploadOldRequirement with wrong sub_stage returns 400', async () => {
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Wrong SubStage Chat', 'verify', 'analysis')
    `).run();

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('some content'), { filename: 'test.md' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'Chat is not in the upload phase' });
  });

  it('POST /api/uploads/uploadOldRequirement with invalid file extension returns 400', async () => {
    createVerifyChat(db, 1, 1);

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('some content'), { filename: 'test.pdf' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'Only .md and .txt files are allowed' });
  });

  it('POST /api/uploads/uploadOldRequirement with .txt extension is accepted', async () => {
    createVerifyChat(db, 1, 1);

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('some content'), { filename: 'test.txt' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.filename, 'OLD_REQUIREMENT.md');
  });

  it('POST /api/uploads/uploadOldRequirement with empty file returns 400', async () => {
    createVerifyChat(db, 1, 1);

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from(''), { filename: 'test.md' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'File must not be empty' });
  });

  it('POST /api/uploads/uploadOldRequirement successful upload saves file and transitions to analysis', async () => {
    createVerifyChat(db, 1, 1);

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const fileContent = '# My Requirement\n\nSome content here.';
    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from(fileContent), { filename: 'myreq.md' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.filename, 'OLD_REQUIREMENT.md');

    const savedPath = path.join(chatDir, 'OLD_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), true);
    assert.strictEqual(fs.readFileSync(savedPath, 'utf-8'), fileContent);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'analysis');
  });

  it('POST /api/uploads/uploadOldRequirement overwrites existing file silently', async () => {
    createVerifyChat(db, 1, 1);
    db.prepare('UPDATE chat_sessions SET running = 1 WHERE id = 1').run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const filepath = path.join(chatDir, 'OLD_REQUIREMENT.md');
    fs.writeFileSync(filepath, 'original content');

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('new content'), { filename: 'updated.md' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(fs.readFileSync(filepath, 'utf-8'), 'new content');
  });

  it('POST /api/uploads/uploadOldRequirement with chatId not in verify stage does not transition', async () => {
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'analysis')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(path.join(chatDir, 'repository'), { recursive: true });
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .field('chatId', '1')
      .attach('file', Buffer.from('content'), { filename: 'test.md' });

    assert.strictEqual(res.status, 400);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.sub_stage, 'analysis');
  });

it('POST /api/uploads/uploadOldRequirement without project access returns 403', async () => {
    db.prepare(`UPDATE ui_settings SET value = 'true' WHERE key = 'security_enabled'`).run({});
    const result = db.prepare(`INSERT INTO users (username, password_hash, role, enabled) VALUES ('regular', 'hash', 'user', 1)`).run({});
    const regularUserId = result.lastInsertRowid as number;
    const secret = getSessionSecret();
    const token = await signJwt({ userId: regularUserId, username: 'user', role: 'user' }, secret);

    const nonAdminApp = express();
    nonAdminApp.use(express.json());
    nonAdminApp.use((req, _res, next) => {
      req.user = { id: regularUserId, username: 'user', role: 'user', enabled: true };
      next();
    });
    nonAdminApp.set('upload', upload);
    nonAdminApp.use('/api/uploads', uploadRouter);

    createVerifyChat(db, 1, 1);

    const request = supertest(nonAdminApp);
    const res = await request
      .post('/api/uploads/uploadOldRequirement')
      .set('Cookie', `openvelo-token=${token}`)
      .field('chatId', '1')
      .attach('file', Buffer.from('some content'), { filename: 'test.md' });
    assert.ok(res.status === 403 || res.status === 401, `Expected 403 or 401 but got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});