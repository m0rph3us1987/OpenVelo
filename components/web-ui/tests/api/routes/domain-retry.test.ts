import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb } from '@/lib/db';
import type { User } from '@/lib/types';
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
      agent_max_timeout INTEGER NOT NULL DEFAULT 300,
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

describe('POST /api/chats/:chatId/domain/retry', () => {
  let db: Database.Database;
  let app: express.Application;
  const adminUser: User = { id: 1, username: 'admin', role: 'admin', enabled: true } as User;
  const originalSetImmediate = globalThis.setImmediate;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    app = buildApp(adminUser);
    globalThis.setImmediate = (() => {
      return {} as any;
    }) as any;
  });

  after(() => {
    globalThis.setImmediate = originalSetImmediate;
    closeDb();
  });

  it('returns 404 for non-existent chat', async () => {
    const res = await makePostRequest(app, '/chats/9999/domain/retry');
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'Chat session not found' });
  });

  it('returns 200, resets running flag, and transitions to domain planning pre-error state', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage, sub_stage_pre_error, running)
      VALUES (1, 'plan', 1, 'Test Chat', 'domain', 'error', 'plan', 1)
    `).run();

    const res = await makePostRequest(app, '/chats/1/domain/retry');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { success: true });

    const updatedChat = db.prepare('SELECT stage, sub_stage, running FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; running: number };
    assert.strictEqual(updatedChat.stage, 'domain');
    assert.strictEqual(updatedChat.sub_stage, 'plan');
    assert.strictEqual(updatedChat.running, 0);
  });
});
