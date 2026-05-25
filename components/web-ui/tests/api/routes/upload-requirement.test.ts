import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import Database from 'better-sqlite3';
import supertest from 'supertest';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { resetTestDb, closeDb } from '@/lib/db';
import { chatsRouter } from '@/api/routes/chats';
import type { User } from '@/lib/types';
import { signJwt } from '@/lib/auth';
import { getSessionSecret } from '@/lib/session';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('theme', 'dark');
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      password_reset_required INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failed_attempt DATETIME,
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
      default_model TEXT NOT NULL DEFAULT 'openai/gpt-4',
      execution_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT 'openai/gpt-4',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      build_cmd TEXT,
      test_cmd TEXT,
      staging_branch TEXT NOT NULL DEFAULT 'staging',
      poll_interval INTEGER NOT NULL DEFAULT 60000,
      agent_max_timeout INTEGER NOT NULL DEFAULT 1800000,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO projects (id, name, port, repo_url, default_model, analyzer_model) VALUES (1, 'Test Project', 3001, 'https://github.com/test/repo', 'openai/gpt-4', 'openai/gpt-4');
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
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify')),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'init',
      sub_stage TEXT NOT NULL DEFAULT '',
      sub_stage_pre_error TEXT NOT NULL DEFAULT '',
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
  app.use('/api/chats', chatsRouter);
  return app;
}

function createTestMulter() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.md' || ext === '.txt') {
        cb(null, true);
      } else {
        cb(new Error('Only .md and .txt files are accepted'));
      }
    }
  });
}

describe('upload-requirement endpoint', () => {
  let db: Database.Database;
  let app: express.Express;
  let upload: multer.Multer;
  const adminUser: User = { id: 1, username: 'admin', role: 'admin', enabled: true } as User;
  const tempDirs: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    upload = createTestMulter();
    app = buildApp(adminUser, upload);
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
    closeDb();
  });

  it('POST /api/chats/:chatId/upload-requirement with .md file saves as ORIGINAL_REQUIREMENT.md and returns 200', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const fileContent = '# My Requirement\n\nSome content here.';
    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from(fileContent), { filename: 'myreq.md' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { success: true });

    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), true);
    assert.strictEqual(fs.readFileSync(savedPath, 'utf-8'), fileContent);
  });

  it('POST /api/chats/:chatId/upload-requirement with .txt file saves as ORIGINAL_REQUIREMENT.md and returns 200', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const fileContent = 'My requirement content.';
    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from(fileContent), { filename: 'myreq.txt' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { success: true });

    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), true);
    assert.strictEqual(fs.readFileSync(savedPath, 'utf-8'), fileContent);
  });

  it('POST /api/chats/:chatId/upload-requirement with invalid extension returns 400', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from('some content'), { filename: 'test.pdf' });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'Only .md and .txt files are accepted' });

    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), false);
  });

  it('POST /api/chats/:chatId/upload-requirement with file exceeding size limit returns 413', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const largeContent = Buffer.alloc(6 * 1024 * 1024);
    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', largeContent, { filename: 'large.md' });

    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.error, 'File too large');

    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), false);
  });

  it('POST /api/chats/:chatId/upload-requirement with no file returns 400', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .field('someField', 'someValue');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'No file uploaded');
  });

  it('POST /api/chats/:chatId/upload-requirement with wrong field name returns 400', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data'), 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('wrongField', Buffer.from('some content'), { filename: 'test.md' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'No file uploaded');
  });

  it('POST /api/chats/:chatId/upload-requirement with non-existent chatId returns 404', async () => {
    const request = supertest(app);
    const res = await request
      .post('/api/chats/9999/upload-requirement')
      .attach('requirement', Buffer.from('some content'), { filename: 'test.md' });

    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'Chat session not found' });
  });

  it('POST /api/chats/:chatId/upload-requirement without project access returns 403', async () => {
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
    nonAdminApp.use('/api/chats', chatsRouter);

    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const request = supertest(nonAdminApp);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .set('Cookie', `openvelo-token=${token}`)
      .attach('requirement', Buffer.from('some content'), { filename: 'test.md' });

    assert.ok(res.status === 403 || res.status === 401, `Expected 403 or 401 but got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe('getHandler dispatch', () => {
  it('getHandler returns handleVerify for stage "verify" (wildcard catch-all)', async () => {
    const workflowModule = await import('@/lib/workflow');

    assert.strictEqual(workflowModule.getHandler('verify', 'upload'), workflowModule.handleVerify);
    assert.strictEqual(workflowModule.getHandler('verify', 'analysis'), workflowModule.handleVerify);
    assert.strictEqual(workflowModule.getHandler('verify', 'satisfied'), workflowModule.handleVerify);
    assert.strictEqual(workflowModule.getHandler('verify', 'error'), workflowModule.handleVerify);
    assert.strictEqual(workflowModule.getHandler('verify', 'any_other_substage'), workflowModule.handleVerify);
  });

  it('getHandler still returns correct handlers for existing stages (no regression)', async () => {
    const workflowModule = await import('@/lib/workflow');

    assert.strictEqual(workflowModule.getHandler('init', ''), workflowModule.handleInit);
    assert.strictEqual(workflowModule.getHandler('analyzing', ''), workflowModule.handleAnalyzing);
    assert.strictEqual(workflowModule.getHandler('analyzing', 'analyzing'), workflowModule.handleAnalyzing);
    assert.strictEqual(workflowModule.getHandler('collecting', ''), workflowModule.handleCollecting);
    assert.strictEqual(workflowModule.getHandler('collecting', 'new'), workflowModule.handleCollecting);
    assert.strictEqual(workflowModule.getHandler('collecting', 'system'), workflowModule.handleCollecting);
    assert.strictEqual(workflowModule.getHandler('collecting', 'user'), workflowModule.handleCollecting);
    assert.strictEqual(workflowModule.getHandler('domain', 'plan'), workflowModule.handleDomain);
    assert.strictEqual(workflowModule.getHandler('domain', 'quiz'), workflowModule.handleDomain);
    assert.strictEqual(workflowModule.getHandler('final_assessment', 'analysis'), workflowModule.handleFinalAssessment);
    assert.strictEqual(workflowModule.getHandler('final_assessment', 'system'), workflowModule.handleFinalAssessment);
    assert.strictEqual(workflowModule.getHandler('final_assessment', 'user'), workflowModule.handleFinalAssessment);
    assert.strictEqual(workflowModule.getHandler('requirement', ''), workflowModule.handleRequirement);
    assert.strictEqual(workflowModule.getHandler('plan', ''), workflowModule.handlePlan);
    assert.strictEqual(workflowModule.getHandler('quick_story', ''), workflowModule.handleQuickStory);
  });
});