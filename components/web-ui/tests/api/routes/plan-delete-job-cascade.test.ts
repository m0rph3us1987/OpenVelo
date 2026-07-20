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
  insertPlanJob,
  getDb,
} from '@/lib/db';
import { planRouter } from '@/api/routes/plan';
import { removeAndRewritePlanJobDependencies } from '@/lib/db';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/plan', planRouter);
  return app;
}

function seedChat(db: Database.Database, projectId = 1, chatId = 10) {
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run();
  db.prepare(`INSERT INTO projects (id, name, port) VALUES (?, 'p', 3001)`).run(projectId);
  db.prepare(`INSERT INTO chat_sessions (id, mode, project_id, name) VALUES (?, 'plan', ?, 'chat')`).run(chatId, projectId);
}

function setDep(jobId: number, depId: number | null) {
  const db = getDb();
  db.prepare('UPDATE plan_jobs SET depends_on = ? WHERE id = ?')
    .run(depId == null ? '[]' : JSON.stringify([depId]), jobId);
}

function getDep(jobId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT depends_on FROM plan_jobs WHERE id = ?').get(jobId) as { depends_on: string };
  return row.depends_on;
}

describe('DELETE /plan/:chatId/jobs/:jobId — cascade rewrite', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    resetTestDb(db);
    initDb();
    setUiSetting('security_enabled', 'false');
    seedChat(db);
  });

  after(() => {
    closeDb();
  });

  it('rewrites C -> [A] when B -> [A] and C -> [B] are seeded and B is deleted', async () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const c = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });
    setDep(b, a);
    setDep(c, b);

    const res = await supertest(buildApp()).delete(`/plan/10/jobs/${b}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.deepStrictEqual(res.body.rewrittenJobIds, [c]);

    assert.strictEqual(getDep(c), JSON.stringify([String(a)]));
    const remaining = db.prepare('SELECT id FROM plan_jobs ORDER BY id ASC').all() as Array<{ id: number }>;
    assert.deepStrictEqual(remaining.map(r => r.id), [a, c]);
  });

  it('clears C -> [] when B is deleted and B had no parent', async () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const c = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });
    setDep(c, b);

    const res = await supertest(buildApp()).delete(`/plan/10/jobs/${b}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(getDep(c), '[]');
    assert.strictEqual(getDep(a), '[]'); // untouched
  });

  it('leaves unrelated jobs untouched when deleting a job nobody depends on', async () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    setDep(b, a);

    const res = await supertest(buildApp()).delete(`/plan/10/jobs/${a}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.rewrittenJobIds, [b]);
    assert.deepStrictEqual(getDep(b), '[]');
  });

  it('returns 404 for an unknown job id', async () => {
    const res = await supertest(buildApp()).delete(`/plan/10/jobs/9999`);
    assert.strictEqual(res.status, 404);
  });

  it('helper correctly removes B from C when B is deleted (direct DB)', () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const c = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });
    setDep(b, a);
    setDep(c, b);

    const bDep = db.prepare('SELECT depends_on FROM plan_jobs WHERE id = ?').get(b) as { depends_on: string };
    db.prepare('DELETE FROM plan_jobs WHERE id = ?').run(b);
    const rewritten = removeAndRewritePlanJobDependencies(10, b, bDep.depends_on);
    assert.deepStrictEqual(rewritten, [c]);
    assert.strictEqual(getDep(c), JSON.stringify([String(a)]));
  });
});
