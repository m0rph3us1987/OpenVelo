import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  initDb,
  resetTestDb,
  closeDb,
  setUiSetting,
  insertPlanJob,
  getDb,
} from '@/lib/db';

interface SeededJob {
  id: number;
  job_index: number;
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

function sortByDepsForChat(chatId: number): number[] {
  const db = getDb();
  const rows = db.prepare('SELECT id, job_index, depends_on FROM plan_jobs WHERE chat_id = ? ORDER BY job_index ASC')
    .all(chatId) as Array<{ id: number; job_index: number; depends_on: string }>;
  const byId = new Map<number, { job_index: number; dep: number | null }>();
  for (const r of rows) {
    let dep: number | null = null;
    try {
      const parsed = JSON.parse(r.depends_on);
      if (Array.isArray(parsed) && parsed.length > 0) dep = Number(parsed[0]) || null;
    } catch { /* ignore */ }
    byId.set(r.id, { job_index: r.job_index, dep });
  }
  const children = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (const r of rows) {
    indeg.set(r.id, 0);
    const dep = byId.get(r.id)!.dep;
    if (dep && byId.has(dep) && dep !== r.id) {
      const list = children.get(dep) ?? [];
      list.push(r.id);
      children.set(dep, list);
      indeg.set(r.id, (indeg.get(r.id) ?? 0) + 1);
    }
  }
  const queue = rows
    .filter(r => (indeg.get(r.id) ?? 0) === 0)
    .map(r => r.id)
    .sort((a, b) => byId.get(a)!.job_index - byId.get(b)!.job_index);
  const out: number[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    const kids = (children.get(id) ?? []).slice().sort((a, b) => byId.get(a)!.job_index - byId.get(b)!.job_index);
    for (const k of kids) {
      const next = (indeg.get(k) ?? 0) - 1;
      indeg.set(k, next);
      if (next === 0) {
        const pos = queue.findIndex(x => byId.get(x)!.job_index > byId.get(k)!.job_index);
        queue.splice(pos === -1 ? queue.length : pos, 0, k);
      }
    }
  }
  return out;
}

describe('Plan jobs ordering by depends_on', () => {
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

  it('orders A -> B -> C by dependency even when job_index is permuted', () => {
    // Insert in order: C (1), A (2), B (3), but wire deps B -> A and C -> B.
    const c = insertPlanJob({ chat_id: 10, job_index: 1, title: 'C', description: '', requirement_line_mapping: '[]' });
    const a = insertPlanJob({ chat_id: 10, job_index: 2, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 3, title: 'B', description: '', requirement_line_mapping: '[]' });
    setDep(b, a);
    setDep(c, b);

    const order = sortByDepsForChat(10);
    assert.deepStrictEqual(order, [a, b, c], 'must follow deps, not job_index');
  });

  it('preserves job_index ASC among siblings with no dependencies', () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const c = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });

    const order = sortByDepsForChat(10);
    assert.deepStrictEqual(order, [a, b, c]);
  });

  it('keeps mixed chains stable: A -> [ ], B -> [A], C -> [ ], D -> [C], order is A B C D (job_index tiebreak among A and C)', () => {
    const a = insertPlanJob({ chat_id: 10, job_index: 1, title: 'A', description: '', requirement_line_mapping: '[]' });
    const b = insertPlanJob({ chat_id: 10, job_index: 2, title: 'B', description: '', requirement_line_mapping: '[]' });
    const c = insertPlanJob({ chat_id: 10, job_index: 3, title: 'C', description: '', requirement_line_mapping: '[]' });
    const d = insertPlanJob({ chat_id: 10, job_index: 4, title: 'D', description: '', requirement_line_mapping: '[]' });
    setDep(b, a);
    setDep(d, c);

    const order = sortByDepsForChat(10);
    assert.deepStrictEqual(order, [a, b, c, d]);
  });
});
