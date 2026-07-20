import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import {
  initDb,
  resetTestDb,
  closeDb,
  setUiSetting,
  getDb,
} from '@/lib/db';
import { projectsRouter } from '@/api/routes/projects';

function seedPlanJobs(chatId: number, titles: string[]): void {
  const db = getDb();
  for (let i = 0; i < titles.length; i++) {
    db.prepare(
      `INSERT INTO plan_jobs (chat_id, job_index, title, description, requirement_line_mapping, content)
       VALUES (?, ?, ?, '', '[]', '')`
    ).run(chatId, i + 1, titles[i]);
  }
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects', projectsRouter);
  return app;
}

describe('POST /projects/:id/create-jobs-from-stories — single I/T pair', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    resetTestDb(db);
    initDb();
    setUiSetting('security_enabled', 'false');
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run();
    db.prepare(`INSERT INTO projects (id, name, port) VALUES (1, 'p', 3001)`).run();
    db.prepare(`INSERT INTO chat_sessions (id, mode, project_id, name) VALUES (1, 'plan', 1, 'chat')`).run();
  });

  after(() => {
    closeDb();
  });

  it('inserts exactly I1=[], T1=[I1] and no trailing row', async () => {
    seedPlanJobs(1, ['Impl One', 'Test: Impl One']);

    const res = await supertest(buildApp())
      .post('/projects/1/create-jobs-from-stories')
      .send({ chatId: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.jobsCreated, 2);
    assert.strictEqual(res.body.jobIds.length, 2);

    const rows = db
      .prepare('SELECT id, depends_on, type FROM jobs ORDER BY id ASC')
      .all() as Array<{ id: number; depends_on: string | null; type: string }>;
    assert.strictEqual(rows.length, 2, 'no extra trailing row should be inserted');

    assert.ok(!rows[0].depends_on, `row0 depends_on should be falsy, got ${rows[0].depends_on}`);
    assert.strictEqual(rows[0].type, 'implementation');
    assert.strictEqual(rows[1].depends_on, JSON.stringify([String(rows[0].id)]));
    assert.strictEqual(rows[1].type, 'test');
  });
});
