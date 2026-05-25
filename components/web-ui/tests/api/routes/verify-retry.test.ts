import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import type { User } from '@/lib/types';
import type { OpenCodeServeClient } from '@/lib/opencode-serve-client';
import { chatsRouter } from '@/api/routes/chats';

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
      port INTEGER NOT NULL,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'opencode',
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
      default_model TEXT NOT NULL DEFAULT '',
      execution_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT '',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
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
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify')),
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

function buildApp(user: User | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/chats', chatsRouter);
  return app;
}

function makePostRequest(app: express.Application, path: string): Promise<{ status: number; body?: unknown }> {
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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            const parsedBody = data ? JSON.parse(data) : undefined;
            resolve({ status: res.statusCode ?? 0, body: parsedBody });
          } catch {
            resolve({ status: res.statusCode ?? 0 });
          }
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe('POST /api/chats/:chatId/verify/retry', () => {
  let db: Database.Database;
  let app: express.Application;
  const adminUser: User = { id: 1, username: 'admin', role: 'admin', enabled: true } as User;
  const originalSetImmediate = globalThis.setImmediate;
  const timers: Array<{ type: string; fn: unknown }> = [];

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    app = buildApp(adminUser);
    timers.length = 0;
    globalThis.setImmediate = ((fn: unknown, ...args: unknown[]) => {
      timers.push({ type: 'setImmediate', fn });
      return originalSetImmediate(fn as Parameters<typeof setImmediate>[0], ...args);
    }) as typeof setImmediate;
  });

  after(() => {
    globalThis.setImmediate = originalSetImmediate;
    serveRegistry.shutdownAll();
    closeDb();
  });

  it('returns 404 for non-existent chat', async () => {
    const res = await makePostRequest(app, '/chats/9999/verify/retry');
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'Chat session not found' });
  });

  it('returns 200 and resets running flag before calling transitionTo for chat in error state', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage, sub_stage_pre_error, running)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'error', 'analysis', 1)
    `).run();

    const res = await makePostRequest(app, '/chats/1/verify/retry');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { success: true });

    const runningBeforeTransition = db.prepare('SELECT running FROM chat_sessions WHERE id = 1').get() as { running: number };
    assert.strictEqual(runningBeforeTransition.running, 0, 'running flag should be reset to false');

    const chat = db.prepare('SELECT stage, sub_stage, sub_stage_pre_error FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; sub_stage_pre_error: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'analysis');
    assert.strictEqual(chat.sub_stage_pre_error, 'analysis');
  });

  it('follows lenient pattern - still processes even when not in error state', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage, sub_stage_pre_error, running)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'upload', 'analysis', 0)
    `).run();

    const res = await makePostRequest(app, '/chats/1/verify/retry');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { success: true });

    const chat = db.prepare('SELECT stage, sub_stage, sub_stage_pre_error FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; sub_stage_pre_error: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'analysis');
  });

  it('retry endpoint invokes verify analysis handler with fresh session', async () => {
    const tempDataPath = path.join(process.cwd(), 'temp_data');
    process.env.OPENVELO_TEMP_DATA_PATH = tempDataPath;
    fs.mkdirSync(tempDataPath, { recursive: true });

    db.prepare(`INSERT OR IGNORE INTO projects (id, name, default_model) VALUES (1, 'Test Project', 'test-default')`).run();
    db.prepare(`INSERT OR IGNORE INTO project_models (project_id, model_key, model_value) VALUES (1, 'analyzer_model', 'test-analyzer')`).run();

    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage, sub_stage_pre_error, running)
      VALUES (1, 'verify', 1, 'Test Chat', 'verify', 'error', 'analysis', 0)
    `).run();

    const chatDir = path.join(tempDataPath, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });
    fs.mkdirSync(path.join(chatDir, 'repository'), { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');

    const createdSessions: string[] = [];
    serveRegistry.getOrCreate = (
      _chatId: number, _chatDir: string, _env: Record<string, string | undefined>
    ) => {
      return {
        ensureStarted: async () => {},
        createSession: async () => {
          const sessionId = `fresh-session-${createdSessions.length + 1}`;
          createdSessions.push(sessionId);
          return sessionId;
        },
        sendMessage: async () => ({ parts: [{ type: 'text', text: '{ "satisfied": true }' }] })
      } as unknown as OpenCodeServeClient;
    };

    const res = await makePostRequest(app, '/chats/1/verify/retry');
    assert.strictEqual(res.status, 200);

    // The retry endpoint transitions to analysis, which should trigger runWorkflow and then handleVerify
    // Since handleVerify is called, it should create a new session (abort existing + create new)
    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'analysis');

    // Verify the session was created (fresh session, not reusing any prior)
    assert.ok(createdSessions.length > 0, 'At least one session should be created on retry');

    // Clean up
    try { fs.rmSync(tempDataPath, { recursive: true }); } catch { /* ignore */ }
  });
});