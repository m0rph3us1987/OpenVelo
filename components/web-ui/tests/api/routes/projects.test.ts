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
      password_hash TEXT,
      port INTEGER NOT NULL DEFAULT 3000,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'opencode',
      default_model TEXT NOT NULL DEFAULT '',
      execution_model TEXT NOT NULL DEFAULT '',
      blueprint_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT '',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      review_model TEXT NOT NULL DEFAULT '',
      documentation_model TEXT NOT NULL DEFAULT '',
      build_cmd TEXT,
      test_cmd TEXT,
      staging_branch TEXT NOT NULL DEFAULT 'staging',
      poll_interval INTEGER NOT NULL DEFAULT 60000,
      agent_max_timeout INTEGER NOT NULL DEFAULT 1800000,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      remove_deleted_containers INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
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

describe('projects router - agent model fields', () => {
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

  describe('POST /projects', () => {
    it('AC1: creates project with blueprint_model, review_model, documentation_model', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects').send({
        name: 'test-project',
        port: 3001,
        blueprint_model: 'anthropic/claude-sonnet',
        review_model: 'anthropic/claude-opus',
        documentation_model: 'openai/gpt-4o',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.blueprint_model, 'anthropic/claude-sonnet');
      assert.strictEqual(res.body.review_model, 'anthropic/claude-opus');
      assert.strictEqual(res.body.documentation_model, 'openai/gpt-4o');
    });

    it('AC2: creates project without three new fields stores empty strings', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects').send({
        name: 'test-project',
        port: 3001,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.blueprint_model, '');
      assert.strictEqual(res.body.review_model, '');
      assert.strictEqual(res.body.documentation_model, '');
    });

    it('AC3: POST response includes the three new fields', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects').send({
        name: 'test-project',
        port: 3001,
        blueprint_model: 'test-provider/model-bp',
        review_model: 'test-provider/model-rv',
        documentation_model: 'test-provider/model-doc',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.blueprint_model, 'test-provider/model-bp');
      assert.strictEqual(res.body.review_model, 'test-provider/model-rv');
      assert.strictEqual(res.body.documentation_model, 'test-provider/model-doc');
    });
  });

  describe('PUT /projects/:id', () => {
    it('AC4: updates only blueprint_model without altering other model fields', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, execution_model, review_model, documentation_model) VALUES ('proj', 3001, 'exec-model', 'rev-model', 'doc-model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.put('/projects/1').send({
        blueprint_model: 'new-blueprint-model',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.blueprint_model, 'new-blueprint-model');
      assert.strictEqual(res.body.execution_model, 'exec-model');
      assert.strictEqual(res.body.review_model, 'rev-model');
      assert.strictEqual(res.body.documentation_model, 'doc-model');
    });

    it('AC5: updates only review_model without altering other model fields', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, blueprint_model, execution_model, documentation_model) VALUES ('proj', 3001, 'bp-model', 'exec-model', 'doc-model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.put('/projects/1').send({
        review_model: 'new-review-model',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.review_model, 'new-review-model');
      assert.strictEqual(res.body.blueprint_model, 'bp-model');
      assert.strictEqual(res.body.execution_model, 'exec-model');
      assert.strictEqual(res.body.documentation_model, 'doc-model');
    });

    it('AC6: updates only documentation_model without altering other model fields', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, blueprint_model, execution_model, review_model) VALUES ('proj', 3001, 'bp-model', 'exec-model', 'rev-model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.put('/projects/1').send({
        documentation_model: 'new-doc-model',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.documentation_model, 'new-doc-model');
      assert.strictEqual(res.body.blueprint_model, 'bp-model');
      assert.strictEqual(res.body.execution_model, 'exec-model');
      assert.strictEqual(res.body.review_model, 'rev-model');
    });

    it('AC7: omits three new fields and does not modify existing stored values', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, blueprint_model, review_model, documentation_model) VALUES ('proj', 3001, 'bp-model', 'rev-model', 'doc-model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.put('/projects/1').send({
        name: 'proj-updated',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'proj-updated');
      assert.strictEqual(res.body.blueprint_model, 'bp-model');
      assert.strictEqual(res.body.review_model, 'rev-model');
      assert.strictEqual(res.body.documentation_model, 'doc-model');
    });

    it('AC8: does NOT strip empty string values for the three new fields (unlike planning_model)', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, blueprint_model, review_model, documentation_model, planning_model) VALUES ('proj', 3001, 'bp-model', 'rev-model', 'doc-model', 'plan-model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.put('/projects/1').send({
        blueprint_model: '',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.blueprint_model, '');
      assert.strictEqual(res.body.review_model, 'rev-model');
      assert.strictEqual(res.body.documentation_model, 'doc-model');
    });
  });

  describe('POST /projects/:id/start', () => {
    it('AC9: returns 400 when resolved blueprint_model is not in models table', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, default_model, blueprint_model, execution_model, review_model, documentation_model) VALUES ('proj', 3001, 'valid/model', 'invalid/bp-model', 'valid/model', 'valid/model', 'valid/model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('valid', 'model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects/1/start');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('invalid/bp-model'));
      assert.ok(res.body.error.includes('blueprint_model'));
    });

    it('AC10: returns 400 when resolved review_model is not in models table', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, default_model, blueprint_model, execution_model, review_model, documentation_model) VALUES ('proj', 3001, 'valid/model', 'valid/model', 'valid/model', 'invalid/rev-model', 'valid/model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('valid', 'model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects/1/start');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('invalid/rev-model'));
      assert.ok(res.body.error.includes('review_model'));
    });

    it('AC11: returns 400 when resolved documentation_model is not in models table', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, default_model, blueprint_model, execution_model, review_model, documentation_model) VALUES ('proj', 3001, 'valid/model', 'valid/model', 'valid/model', 'valid/model', 'invalid/doc-model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('valid', 'model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects/1/start');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('invalid/doc-model'));
      assert.ok(res.body.error.includes('documentation_model'));
    });

    it('AC12: succeeds when all four resolved agent models exist in models table', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, default_model, blueprint_model, execution_model, review_model, documentation_model) VALUES ('proj', 3001, 'default/model', 'blueprint/model', 'execution/model', 'review/model', 'documentation/model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('default', 'model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('blueprint', 'model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('execution', 'model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('review', 'model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('documentation', 'model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects/1/start');

      assert.strictEqual(res.status, 500);
    });

    it('AC13: execution_model and default_model validation continues to function', async () => {
      setUiSetting('security_enabled', 'false');
      db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
      db.prepare(`INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, review_model, documentation_model) VALUES ('proj', 3001, 'valid/model', 'valid/model', 'valid/model', 'valid/model', 'valid/model')`).run({});
      db.prepare(`INSERT INTO models (provider, model_name) VALUES ('valid', 'model')`).run({});

      const adminUser = { id: 1, username: 'admin', role: 'admin' } as User;
      const app = buildApp(adminUser);
      const agent = supertest(app);

      const res = await agent.post('/projects/1/start');
      assert.strictEqual(res.status, 500);
    });
  });
});