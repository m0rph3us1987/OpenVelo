import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after, beforeEach } from 'node:test';
import { initDb, resetTestDb, closeDb } from '@/lib/db';

describe('db.ts test-job field migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  after(() => {
    closeDb();
  });

  it('adds test_plan_markdown + implements_job_id to jobs with correct defaults', () => {
    const info = db.prepare("PRAGMA table_info(jobs)").all() as { name: string; notnull: number; dflt_value: string | null }[];
    const names = info.map(c => c.name);

    assert.ok(names.includes('test_plan_markdown'), 'jobs should have test_plan_markdown column');
    assert.ok(names.includes('implements_job_id'), 'jobs should have implements_job_id column');
    assert.ok(names.includes('verdict'), 'jobs should have verdict column');
    assert.ok(names.includes('summary'), 'jobs should have summary column');

    const tpm = info.find(c => c.name === 'test_plan_markdown')!;
    assert.strictEqual(tpm.notnull, 1, 'test_plan_markdown should be NOT NULL');
    assert.strictEqual(tpm.dflt_value, "''", 'test_plan_markdown should default to empty string');

    const iji = info.find(c => c.name === 'implements_job_id')!;
    assert.strictEqual(iji.notnull, 0, 'implements_job_id should be nullable');
    assert.strictEqual(iji.dflt_value, null, 'implements_job_id should default to NULL');

    const v = info.find(c => c.name === 'verdict')!;
    assert.strictEqual(v.notnull, 0, 'verdict should be nullable');
    assert.strictEqual(v.dflt_value, null, 'verdict should default to NULL');

    const s = info.find(c => c.name === 'summary')!;
    assert.strictEqual(s.notnull, 0, 'summary should be nullable');
    assert.strictEqual(s.dflt_value, null, 'summary should default to NULL');
  });

  it('adds test_plan_markdown + implements_job_id to plan_jobs with correct defaults', () => {
    const info = db.prepare("PRAGMA table_info(plan_jobs)").all() as { name: string; notnull: number; dflt_value: string | null }[];
    const names = info.map(c => c.name);

    assert.ok(names.includes('test_plan_markdown'), 'plan_jobs should have test_plan_markdown column');
    assert.ok(names.includes('implements_job_id'), 'plan_jobs should have implements_job_id column');

    const tpm = info.find(c => c.name === 'test_plan_markdown')!;
    assert.strictEqual(tpm.notnull, 1, 'test_plan_markdown should be NOT NULL');
    assert.strictEqual(tpm.dflt_value, "''", 'test_plan_markdown should default to empty string');

    const iji = info.find(c => c.name === 'implements_job_id')!;
    assert.strictEqual(iji.notnull, 0, 'implements_job_id should be nullable');
    assert.strictEqual(iji.dflt_value, null, 'implements_job_id should default to NULL');
  });

  it('persists non-default values for test_plan_markdown and implements_job_id in jobs', () => {
    const parentResult = db.prepare(`
      INSERT INTO jobs (title, status, type, test_plan_markdown, implements_job_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('impl-job', 'PENDING', 'implementation', '', null);
    const parentId = Number(parentResult.lastInsertRowid);

    const testPlan = '## Test Plan\n- Positive: API returns 200\n- Negative: API returns 400 on invalid input';
    const testResult = db.prepare(`
      INSERT INTO jobs (title, status, type, test_plan_markdown, implements_job_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('test-job', 'PENDING', 'test', testPlan, parentId);
    const testId = Number(testResult.lastInsertRowid);

    const row = db.prepare(
      'SELECT test_plan_markdown, implements_job_id FROM jobs WHERE id = ?'
    ).get(testId) as { test_plan_markdown: string; implements_job_id: number | null };

    assert.strictEqual(row.test_plan_markdown, testPlan);
    assert.strictEqual(row.implements_job_id, parentId);

    const parentRow = db.prepare(
      'SELECT test_plan_markdown, implements_job_id FROM jobs WHERE id = ?'
    ).get(parentId) as { test_plan_markdown: string; implements_job_id: number | null };
    assert.strictEqual(parentRow.test_plan_markdown, '');
    assert.strictEqual(parentRow.implements_job_id, null);
  });

  it('persists non-default values for test_plan_markdown and implements_job_id in plan_jobs', () => {
    const chatId = 1;
    db.prepare(`
      INSERT INTO projects (id, name, port) VALUES (1, 'p', 30099)
    `).run();
    db.prepare(`
      INSERT INTO chat_sessions (id, mode, project_id, name) VALUES (?, 'plan', 1, 'chat')
    `).run(chatId);

    const parentResult = db.prepare(`
      INSERT INTO plan_jobs (chat_id, job_index, title, description, requirement_line_mapping, test_plan_markdown, implements_job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(chatId, 1, 'impl', 'desc', '[]', '', null);
    const parentId = Number(parentResult.lastInsertRowid);

    const testPlan = '## Test Plan\n- positive: x\n- negative: y';
    const testResult = db.prepare(`
      INSERT INTO plan_jobs (chat_id, job_index, title, description, requirement_line_mapping, test_plan_markdown, implements_job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(chatId, 2, 'test', 'desc', '[]', testPlan, parentId);

    const row = db.prepare(
      'SELECT test_plan_markdown, implements_job_id FROM plan_jobs WHERE id = ?'
    ).get(testResult.lastInsertRowid as number) as { test_plan_markdown: string; implements_job_id: number | null };

    assert.strictEqual(row.test_plan_markdown, testPlan);
    assert.strictEqual(row.implements_job_id, parentId);
  });

  it('initDb() is idempotent (running twice does not error)', () => {
    assert.doesNotThrow(() => {
      initDb();
    }, 'initDb() should not throw when called twice');
  });
});
