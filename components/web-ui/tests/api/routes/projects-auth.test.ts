import { describe, it, beforeEach, after } from 'node:test';
import assert from 'assert';
import express from 'express';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb, setUiSetting } from '@/lib/db';
import { projectsRouter } from '@/api/routes/projects';
import type { User } from '@/lib/types';

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
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
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
      agent_max_timeout INTEGER NOT NULL DEFAULT 1800000,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS group_projects (
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, project_id)
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
  app.use('/projects', projectsRouter);
  return app;
}

describe('projects router auth', () => {
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

  it('admin can list all projects', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});

    const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
    const app = buildApp(adminUser);
    const agent = supertest(app);

    const res = await agent.get('/projects');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
  });

  it('regular user lists only group-linked projects', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});

    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-c', 3003)`).run({});

    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 2)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 2)`).run({});

    const regularUser = { id: 2, username: 'user', role: 'user' } as User;
    const app = buildApp(regularUser);
    const agent = supertest(app);

    const res = await agent.get('/projects');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.ok(res.body.some((p: { name: string }) => p.name === 'proj-a'));
    assert.ok(res.body.some((p: { name: string }) => p.name === 'proj-b'));
    assert.ok(!res.body.some((p: { name: string }) => p.name === 'proj-c'));
  });

  it('regular user gets 403 for unauthorized project GET', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});
    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 2)`).run({});

    const regularUser = { id: 1, username: 'user', role: 'user' } as User;
    const app = buildApp(regularUser);
    const agent = supertest(app);

    const res = await agent.get('/projects/1');

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.body, { error: 'Forbidden' });
  });

  it('regular user gets 403 on POST', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});

    const regularUser = { id: 1, username: 'user', role: 'user' } as User;
    const app = buildApp(regularUser);
    const agent = supertest(app);

    const res = await agent.post('/projects').send({ name: 'newproj', port: 3005 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.body, { error: 'Forbidden' });
  });

  it('regular user gets 403 on DELETE', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});

    const regularUser = { id: 1, username: 'user', role: 'user' } as User;
    const app = buildApp(regularUser);
    const agent = supertest(app);

    const res = await agent.delete('/projects/1');

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.body, { error: 'Forbidden' });
  });

  it('regular user can PUT authorized project', async () => {
    setUiSetting('security_enabled', 'true');

    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 1)`).run({});

    const regularUser = { id: 1, username: 'user', role: 'user' } as User;
    const app = buildApp(regularUser);
    const agent = supertest(app);

    const res = await agent.put('/projects/1').send({ name: 'proj-a-updated' });

    assert.strictEqual(res.status, 200);
  });
});