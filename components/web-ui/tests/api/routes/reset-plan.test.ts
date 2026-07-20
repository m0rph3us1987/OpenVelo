import { describe, it, beforeEach, after } from 'node:test';
import assert from 'assert';
import express from 'express';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { resetTestDb, closeDb, getDb, initDb, updateJob } from '@/lib/db';
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
      agent_max_timeout INTEGER NOT NULL DEFAULT 300,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      remove_deleted_containers INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      container_id TEXT,
      vnc_host_port INTEGER,
      branch TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      stage TEXT,
      agent_attempt INTEGER,
      agent_max_retries INTEGER,
      started_at TEXT,
      runtime INTEGER NOT NULL DEFAULT 0,
      test_plan_markdown TEXT NOT NULL DEFAULT '',
      implements_job_id INTEGER,
      verdict TEXT,
      summary TEXT,
      passed_tests TEXT,
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
  app.use('/projects', projectsRouter);
  return app;
}

describe('projects router - reset-plan endpoint', () => {
  let db: Database.Database;
  const adminUser: User = { id: 1, username: 'admin', role: 'ADMIN' };

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    createTables(db);
    initDb();

    // Insert dummy project
    db.prepare(`
      INSERT INTO projects (id, name, port) VALUES (1, 'Test Project', 3001)
    `).run();

    // Insert dummy job
    db.prepare(`
      INSERT INTO jobs (id, project_id, title, status, type, passed_tests)
      VALUES (42, 1, 'Dummy Test Job', 'PENDING', 'test', '{"tasks": [{"id":"1", "task":"Test 1", "verdict":"pass"}]}')
    `).run();
  });

  after(() => {
    closeDb();
  });

  it('resets passed_tests to null for a valid job and project', async () => {
    const app = buildApp(adminUser);
    const res = await supertest(app)
      .post('/projects/1/jobs/42/reset-plan')
      .expect(200);

    assert.deepStrictEqual(res.body, { success: true });

    // Verify database field is reset to null
    const job = db.prepare('SELECT passed_tests FROM jobs WHERE id = ?').get(42) as any;
    assert.strictEqual(job.passed_tests, null);
  });
});
