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

function seedPlanJobs(chatId: number, jobs: Array<{ title: string, test_plan_markdown?: string }>): void {
  const db = getDb();
  for (let i = 0; i < jobs.length; i++) {
    db.prepare(
      `INSERT INTO plan_jobs (chat_id, job_index, title, description, requirement_line_mapping, content, test_plan_markdown)
       VALUES (?, ?, ?, '', '[]', '', ?)`
    ).run(chatId, i + 1, jobs[i].title, jobs[i].test_plan_markdown ?? '');
  }
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects', projectsRouter);
  return app;
}

describe('POST /projects/:id/create-jobs-from-stories — non-alternating chain and test_plan_markdown', () => {
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

  it('correctly links dependencies when some implementation jobs do not have a test job and populates test_plan_markdown', async () => {
    const testPlanTwo = '# Test Plan: Impl Two\n\n## Positive Cases\n- Click something';
    const testPlanThree = '# Test Plan: Impl Three\n\n## Positive Cases\n- Click another thing';

    seedPlanJobs(1, [
      { title: 'Impl One' },
      { title: 'Impl Two' },
      { title: 'Test: Impl Two', test_plan_markdown: testPlanTwo },
      { title: 'Impl Three' },
      { title: 'Test: Impl Three', test_plan_markdown: testPlanThree },
    ]);

    const res = await supertest(buildApp())
      .post('/projects/1/create-jobs-from-stories')
      .send({ chatId: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.jobsCreated, 5);

    const rows = db
      .prepare('SELECT id, title, depends_on, type, description, test_plan_markdown, implements_job_id FROM jobs ORDER BY id ASC')
      .all() as Array<{
        id: number;
        title: string;
        depends_on: string | null;
        type: string;
        description: string;
        test_plan_markdown: string;
        implements_job_id: number | null;
      }>;
    assert.strictEqual(rows.length, 5);

    // Job 0: Impl One
    assert.strictEqual(rows[0].title, 'Impl One');
    assert.ok(!rows[0].depends_on);
    assert.strictEqual(rows[0].type, 'implementation');
    assert.strictEqual(rows[0].test_plan_markdown, '');

    // Job 1: Impl Two
    assert.strictEqual(rows[1].title, 'Impl Two');
    assert.strictEqual(rows[1].depends_on, JSON.stringify([String(rows[0].id)]));
    assert.strictEqual(rows[1].type, 'implementation');
    assert.strictEqual(rows[1].test_plan_markdown, '');

    // Job 2: Test: Impl Two
    assert.strictEqual(rows[2].title, 'Test: Impl Two');
    assert.strictEqual(rows[2].depends_on, JSON.stringify([String(rows[1].id)]));
    assert.strictEqual(rows[2].type, 'test');
    assert.strictEqual(rows[2].description, testPlanTwo);
    assert.strictEqual(rows[2].test_plan_markdown, testPlanTwo);
    assert.strictEqual(rows[2].implements_job_id, rows[1].id);

    // Job 3: Impl Three
    assert.strictEqual(rows[3].title, 'Impl Three');
    assert.strictEqual(rows[3].depends_on, JSON.stringify([String(rows[2].id)]));
    assert.strictEqual(rows[3].type, 'implementation');
    assert.strictEqual(rows[3].test_plan_markdown, '');

    // Job 4: Test: Impl Three
    assert.strictEqual(rows[4].title, 'Test: Impl Three');
    assert.strictEqual(rows[4].depends_on, JSON.stringify([String(rows[3].id)]));
    assert.strictEqual(rows[4].type, 'test');
    assert.strictEqual(rows[4].description, testPlanThree);
    assert.strictEqual(rows[4].test_plan_markdown, testPlanThree);
    assert.strictEqual(rows[4].implements_job_id, rows[3].id);
  });
});
