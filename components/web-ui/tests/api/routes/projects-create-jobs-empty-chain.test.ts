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

describe('POST /projects/:id/create-jobs-from-stories — impl without paired test', () => {
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

  it('inserts the lone implementation with depends_on=[] and no synthetic test/impl row', async () => {
    seedPlanJobs(1, ['Impl Only']);

    const res = await supertest(buildApp())
      .post('/projects/1/create-jobs-from-stories')
      .send({ chatId: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.jobsCreated, 1);
    assert.strictEqual(res.body.jobIds.length, 1);

    const rows = db
      .prepare('SELECT id, depends_on, type FROM jobs ORDER BY id ASC')
      .all() as Array<{ id: number; depends_on: string | null; type: string }>;
    assert.strictEqual(rows.length, 1, 'no synthetic test/impl should be appended');
    assert.ok(!rows[0].depends_on, `row0 depends_on should be falsy, got ${rows[0].depends_on}`);
    assert.strictEqual(rows[0].type, 'implementation');
  });
});
