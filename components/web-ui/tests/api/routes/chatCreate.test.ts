import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
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
      running INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plan_epics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      epic_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      build_cmd TEXT NOT NULL DEFAULT '',
      test_cmd TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, epic_index)
    );
    CREATE TABLE IF NOT EXISTS plan_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      epic_id INTEGER NOT NULL REFERENCES plan_epics(id) ON DELETE CASCADE,
      feature_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, epic_id, feature_index)
    );
    CREATE TABLE IF NOT EXISTS plan_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES plan_features(id) ON DELETE CASCADE,
      story_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, feature_id, story_index)
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

function makePostRequest(app: express.Application, path: string, body: unknown): Promise<{ status: number; body?: unknown }> {
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
          'Content-Length': Buffer.byteLength(bodyStr)
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
      req.write(bodyStr);
      req.end();
    });
  });
}

describe('chatCreate endpoint', () => {
  let db: Database.Database;
  let app: express.Application;
  const adminUser: User = { id: 1, username: 'admin', role: 'admin', enabled: true } as User;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    app = buildApp(adminUser);
  });

  after(() => {
    serveRegistry.shutdownAll();
    closeDb();
  });

  it('accepts verify mode and stores it correctly', async () => {
    const res = await makePostRequest(app, '/chats/chatCreate', {
      mode: 'verify',
      name: 'test-verify',
      project_id: 1
    });
    assert.strictEqual(res.status, 201);
    const chat = res.body as { id: number; mode: string; name: string };
    assert.strictEqual(chat.mode, 'verify');
    assert.strictEqual(chat.name, 'test-verify');

    const dbChat = db.prepare('SELECT mode, name FROM chat_sessions WHERE id = ?').get(chat.id) as { mode: string; name: string };
    assert.strictEqual(dbChat.mode, 'verify');
    assert.strictEqual(dbChat.name, 'test-verify');
  });

  it('rejects invalid mode with 400 and correct error message', async () => {
    const res = await makePostRequest(app, '/chats/chatCreate', {
      mode: 'bogus',
      name: 'test-bogus',
      project_id: 1
    });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'mode must be plan, quick, or verify' });
  });

  it('accepts plan mode (no regression)', async () => {
    const res = await makePostRequest(app, '/chats/chatCreate', {
      mode: 'plan',
      name: 'test-plan',
      project_id: 1
    });
    assert.strictEqual(res.status, 201);
    const chat = res.body as { mode: string };
    assert.strictEqual(chat.mode, 'plan');
  });

  it('accepts quick mode (no regression)', async () => {
    const res = await makePostRequest(app, '/chats/chatCreate', {
      mode: 'quick',
      name: 'test-quick',
      project_id: 1
    });
    assert.strictEqual(res.status, 201);
    const chat = res.body as { mode: string };
    assert.strictEqual(chat.mode, 'quick');
  });

  it('rejects missing mode', async () => {
    const res = await makePostRequest(app, '/chats/chatCreate', {
      name: 'test-no-mode',
      project_id: 1
    });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'mode, name, and project_id are required' });
  });
});