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
  getNextRunnableJobs,
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

describe('POST /projects/:id/create-jobs-from-stories — type column + scheduler dispatch order', () => {
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

  it('preserves type per row and dispatches in I1→T1→I2→T2→I3→T3 order via the existing scheduler', async () => {
    seedPlanJobs(1, [
      'Impl One',
      'Test: Impl One',
      'Impl Two',
      'Test: Impl Two',
      'Impl Three',
      'Test: Impl Three',
    ]);

    const res = await supertest(buildApp())
      .post('/projects/1/create-jobs-from-stories')
      .send({ chatId: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.jobsCreated, 6);

    const rows = db
      .prepare('SELECT id, type FROM jobs ORDER BY id ASC')
      .all() as Array<{ id: number; type: string }>;
    assert.strictEqual(rows.length, 6);

    const expectedTypes = ['implementation', 'test', 'implementation', 'test', 'implementation', 'test'];
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.strictEqual(rows[i].type, expectedTypes[i], `row ${i} type mismatch`);
    }

    const dispatchOrder: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const next = getNextRunnableJobs(1, 1);
      assert.strictEqual(next.length, 1, `expected exactly 1 runnable at step ${i}, got ${next.length}`);
      dispatchOrder.push(next[0].id);
      db.prepare("UPDATE jobs SET status = 'COMPLETED' WHERE id = ?").run(next[0].id);
    }

    const expectedOrder = rows.map((r) => r.id);
    assert.deepStrictEqual(dispatchOrder, expectedOrder);
  });
});
