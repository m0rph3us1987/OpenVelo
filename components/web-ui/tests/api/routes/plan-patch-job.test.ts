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
  getPlanJobs,
} from '@/lib/db';
import { planRouter } from '@/api/routes/plan';

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

describe('PATCH /plan/:chatId/jobs/:jobId', () => {
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

  it('updates only title when only title is supplied', async () => {
    const id = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: 'desc', requirement_line_mapping: '[]' });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${id}`)
      .send({ title: 'A renamed' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'A renamed');
    assert.strictEqual(res.body.description, 'desc');
    assert.strictEqual(getPlanJobs(10)[0].title, 'A renamed');
  });

  it('updates depends_on when a single id is supplied', async () => {
    const aId = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const bId = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });

    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${bId}`)
      .send({ depends_on: [aId] });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.depends_on, '[' + aId + ']');
    const rows = getPlanJobs(10);
    const bRow = rows.find(r => r.id === bId)!;
    assert.strictEqual(bRow.depends_on, JSON.stringify([aId]));
  });

  it('clears depends_on when an empty array is supplied', async () => {
    const aId = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const bId = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });

    await supertest(buildApp()).patch(`/plan/10/jobs/${bId}`).send({ depends_on: [aId] });
    const cleared = await supertest(buildApp())
      .patch(`/plan/10/jobs/${bId}`)
      .send({ depends_on: [] });
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual(cleared.body.depends_on, '[]');
  });

  it('rejects depends_on with more than one entry (400)', async () => {
    const aId = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const bId = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const cId = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });

    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${cId}`)
      .send({ depends_on: [aId, bId] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /at most one/);
  });

  it('rejects depends_on containing an id from another chat', async () => {
    const other = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    db.prepare(`INSERT INTO projects (id, name, port) VALUES (2, 'p2', 3002)`).run();
    db.prepare(`INSERT INTO chat_sessions (id, mode, project_id, name) VALUES (11, 'plan', 2, 'chat2')`).run();
    const bId = insertPlanJob({ chat_id: 11, job_index: 1, title: 'B', description: '', requirement_line_mapping: '[]' });

    const res = await supertest(buildApp())
      .patch(`/plan/11/jobs/${bId}`)
      .send({ depends_on: [other] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /not found in this chat/);
  });

  it('rejects depends_on pointing at itself', async () => {
    const aId = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${aId}`)
      .send({ depends_on: [aId] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /itself/);
  });

  it('returns 404 for an unknown job id', async () => {
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/9999`)
      .send({ title: 'no-op' });
    assert.strictEqual(res.status, 404);
  });

  it('updates content (specification) when supplied', async () => {
    const id = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${id}`)
      .send({ content: '# Spec\n\nHello world' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.content, '# Spec\n\nHello world');
    const rows = getPlanJobs(10);
    assert.strictEqual(rows[0].content, '# Spec\n\nHello world');
  });

  it('updates test_plan_markdown when supplied', async () => {
    const id = insertPlanJob({
      chat_id: 10,
      job_index: 1,
      title: 'A',
      description: '',
      requirement_line_mapping: '[]',
      implements_job_id: 999,
    });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${id}`)
      .send({ test_plan_markdown: '# Test plan' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.test_plan_markdown, '# Test plan');
  });

  it('rejects non-string content (400)', async () => {
    const id = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${id}`)
      .send({ content: 123 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /content/);
  });

  it('accepts null content (clear the spec)', async () => {
    const id = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const res = await supertest(buildApp())
      .patch(`/plan/10/jobs/${id}`)
      .send({ content: null });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.content, null);
  });
});
