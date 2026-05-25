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

describe('upload-requirement storage behaviors', () => {
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

  it('(a) file is always saved as ORIGINAL_REQUIREMENT.md regardless of original extension', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    tempDirs.push(chatDir);

    const fileContent = '# Requirement Content';
    const request = supertest(app);

    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from(fileContent), { filename: 'anything.txt' });

    assert.strictEqual(res.status, 200);
    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), true);
    assert.strictEqual(fs.readFileSync(savedPath, 'utf-8'), fileContent);
  });

  it('(b) chat directory is created if it does not exist', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    assert.strictEqual(fs.existsSync(chatDir), false);
    tempDirs.push(chatDir);

    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from('# Test'), { filename: 'test.md' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(fs.existsSync(chatDir), true);
    const savedPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    assert.strictEqual(fs.existsSync(savedPath), true);
  });

  it('(b2) directory creation failure returns 500 and does not call transitionTo', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    tempDirs.push(chatDir);

    const origMkdirSync = fs.mkdirSync;
    (fs as typeof fs & { mkdirSync: typeof fs.mkdirSync }).mkdirSync = function () {
      throw new Error('EPERM');
    };

    try {
      const request = supertest(app);
      const res = await request
        .post('/api/chats/1/upload-requirement')
        .attach('requirement', Buffer.from('# Test'), { filename: 'test.md' });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error, 'Failed to create chat directory');

      const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string } | undefined;
      assert.strictEqual(chat?.stage, 'verify');
      assert.strictEqual(chat?.sub_stage, 'upload');
    } finally {
      (fs as typeof fs & { mkdirSync: typeof fs.mkdirSync }).mkdirSync = origMkdirSync;
    }
  });

  it('(c) existing ORIGINAL_REQUIREMENT.md is overwritten on re-upload', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const existingPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    fs.writeFileSync(existingPath, 'Old content', 'utf-8');
    assert.strictEqual(fs.readFileSync(existingPath, 'utf-8'), 'Old content');

    const request = supertest(app);
    const res = await request
      .post('/api/chats/1/upload-requirement')
      .attach('requirement', Buffer.from('New content'), { filename: 'updated.txt' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(fs.existsSync(existingPath), true);
    assert.strictEqual(fs.readFileSync(existingPath, 'utf-8'), 'New content');
  });

  it('(d) filesystem write error returns 500 and does not leave a partial file', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const destPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    const tmpPath = destPath + '.tmp';

    const origRenameSync = fs.renameSync;
    (fs as typeof fs & { renameSync: typeof fs.renameSync }).renameSync = function (src: fs.PathLike, dst: fs.PathLike) {
      if (String(src).endsWith('.tmp') && String(dst).endsWith('ORIGINAL_REQUIREMENT.md')) {
        throw new Error('Simulated disk full error');
      }
      return origRenameSync(src, dst);
    };

    try {
      const request = supertest(app);
      const res = await request
        .post('/api/chats/1/upload-requirement')
        .attach('requirement', Buffer.from('# Test'), { filename: 'test.md' });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error, 'Failed to save file');
      assert.strictEqual(fs.existsSync(tmpPath), false, 'partial tmp file should be cleaned up');
    } finally {
      (fs as typeof fs & { renameSync: typeof fs.renameSync }).renameSync = origRenameSync;
    }
  });

  it('(e) transitionTo is only called on successful write', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload')
    `).run();

    const baseDir = process.env.OPENVELO_TEMP_DATA_PATH || path.join(process.cwd(), 'temp_data');
    const chatDir = path.join(baseDir, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    tempDirs.push(chatDir);

    const destPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    const tmpPath = destPath + '.tmp';

    const origRenameSync = fs.renameSync;
    (fs as typeof fs & { renameSync: typeof fs.renameSync }).renameSync = function (src: fs.PathLike, dst: fs.PathLike) {
      if (String(src).endsWith('.tmp') && String(dst).endsWith('ORIGINAL_REQUIREMENT.md')) {
        throw new Error('Simulated rename error');
      }
      return origRenameSync(src, dst);
    };

    try {
      const request = supertest(app);
      const res = await request
        .post('/api/chats/1/upload-requirement')
        .attach('requirement', Buffer.from('# Test'), { filename: 'test.md' });

      assert.strictEqual(res.status, 500);

      const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string } | undefined;
      assert.strictEqual(chat?.stage, 'verify');
      assert.strictEqual(chat?.sub_stage, 'upload');
    } finally {
      (fs as typeof fs & { renameSync: typeof fs.renameSync }).renameSync = origRenameSync;
    }
  });
});