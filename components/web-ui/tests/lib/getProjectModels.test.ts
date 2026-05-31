import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after, beforeEach } from 'node:test';
import path from 'path';
import fs from 'fs';

function createTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join('/', 'tmp', 'getProjectModels-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      port INTEGER NOT NULL,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'opencode',
      build_cmd TEXT,
      test_cmd TEXT,
      staging_branch TEXT NOT NULL DEFAULT 'staging',
      poll_interval INTEGER NOT NULL DEFAULT 60000,
      agent_max_timeout INTEGER NOT NULL DEFAULT 1800000,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      default_model TEXT NOT NULL DEFAULT '',
      execution_model TEXT NOT NULL DEFAULT '',
      blueprint_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT '',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      review_model TEXT NOT NULL DEFAULT '',
      documentation_model TEXT NOT NULL DEFAULT ''
    )
  `);

  return db;
}

describe('getProjectModels', () => {
  const tmpDir = fs.mkdtempSync(path.join('/', 'tmp', 'getProjectModels-test-'));
  let db: Database.Database;
  let getProjectModels: (projectId: number) => ReturnType<typeof import('@/lib/db').getProjectModels>;

  beforeEach(() => {
    db = createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/db').resetTestDb(db);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    getProjectModels = require('@/lib/db').getProjectModels;
  });

  after(() => {
    try { db.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('returns all nine model fields', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', 'anthropic/claude-3', 'openai/gpt-4o-mini', 'google/gemini-2.0', 'openai/gpt-4o', 'anthropic/claude-3-sonnet', 'google/gemini-2.0-flash')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.default_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.execution_model, 'openai/gpt-4o');
    assert.strictEqual(result.blueprint_model, 'anthropic/claude-3-opus');
    assert.strictEqual(result.analyzer_model, 'anthropic/claude-3');
    assert.strictEqual(result.chat_model, 'openai/gpt-4o-mini');
    assert.strictEqual(result.requirement_model, 'google/gemini-2.0');
    assert.strictEqual(result.planning_model, 'openai/gpt-4o');
    assert.strictEqual(result.review_model, 'anthropic/claude-3-sonnet');
    assert.strictEqual(result.documentation_model, 'google/gemini-2.0-flash');
  });

  it('blueprint_model falls back to default_model when empty string', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', '', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.blueprint_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.execution_model, 'openai/gpt-4o');
  });

  it('review_model falls back to default_model when empty string', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.review_model, 'google/gemini-2.5-pro');
  });

  it('documentation_model falls back to default_model when empty string', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.documentation_model, 'google/gemini-2.5-pro');
  });

  it('blueprint_model returns concrete value when set', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.blueprint_model, 'anthropic/claude-3-opus');
    assert.strictEqual(result.default_model, 'google/gemini-2.5-pro');
  });

  it('review_model returns concrete value when set', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', '', '', '', '', 'anthropic/claude-3-sonnet', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.review_model, 'anthropic/claude-3-sonnet');
    assert.strictEqual(result.default_model, 'google/gemini-2.5-pro');
  });

  it('documentation_model returns concrete value when set', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', 'anthropic/claude-3-opus', '', '', '', '', '', 'google/gemini-2.0-flash')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.documentation_model, 'google/gemini-2.0-flash');
    assert.strictEqual(result.default_model, 'google/gemini-2.5-pro');
  });

  it('fallback behavior is independent per field', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', '', '', '', '', '', 'anthropic/claude-3-sonnet', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.blueprint_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.review_model, 'anthropic/claude-3-sonnet');
    assert.strictEqual(result.documentation_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.execution_model, 'openai/gpt-4o');
  });

  it('throws when default_model is empty/falsy', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, '', '', '', '', '', '', '', '', '')
    `).run();

    assert.throws(() => {
      getProjectModels(1);
    }, /default_model/);
  });

  it('throws when project not found', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', '', '', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.execution_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.analyzer_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.chat_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.requirement_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.planning_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.blueprint_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.review_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.documentation_model, 'google/gemini-2.5-pro');
  });

  it('execution_model returns the concrete value when set', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', '', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.execution_model, 'openai/gpt-4o');
    assert.strictEqual(result.default_model, 'google/gemini-2.5-pro');
  });

  it('non-execution_model fields fall back to default_model when empty string', () => {
    db.prepare(`
      INSERT INTO projects (name, port, default_model, execution_model, blueprint_model, analyzer_model, chat_model, requirement_model, planning_model, review_model, documentation_model)
      VALUES ('test-project', 3001, 'google/gemini-2.5-pro', 'openai/gpt-4o', '', '', '', '', '', '', '')
    `).run();

    const result = getProjectModels(1);

    assert.strictEqual(result.analyzer_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.chat_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.requirement_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.planning_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.blueprint_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.review_model, 'google/gemini-2.5-pro');
    assert.strictEqual(result.documentation_model, 'google/gemini-2.5-pro');
  });

  it('throws when project not found', () => {
    assert.throws(() => {
      getProjectModels(99999);
    }, /Project not found/);
  });
});