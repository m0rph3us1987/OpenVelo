import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { resetTestDb, getDb, insertPlanJob, getPlanJobs } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import type { OpenCodeServeClient } from '@/lib/opencode-serve-client';
import { handlePlan } from '@/lib/workflow/stage-plan';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      port INTEGER NOT NULL DEFAULT 3000,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'kilo',
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
      default_model TEXT NOT NULL DEFAULT 'openai/gpt-4',
      execution_model TEXT NOT NULL DEFAULT '',
      blueprint_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT 'openai/gpt-4',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      review_model TEXT NOT NULL DEFAULT '',
      documentation_model TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO projects (id, name, port, repo_url, default_model, analyzer_model) VALUES (1, 'Test Project', 3001, 'https://github.com/test/repo', 'openai/gpt-4', 'openai/gpt-4');
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify', 'requirement')),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'init',
      sub_stage TEXT NOT NULL DEFAULT '',
      sub_stage_pre_error TEXT NOT NULL DEFAULT '',
      running INTEGER NOT NULL DEFAULT 0,
      error_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plan_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      job_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirement_line_mapping TEXT NOT NULL,
      content TEXT,
      build_cmd TEXT NOT NULL DEFAULT '',
      test_cmd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      logs TEXT NOT NULL DEFAULT '',
      block_id INTEGER,
      block_sequence INTEGER DEFAULT 0,
      test_plan_markdown TEXT NOT NULL DEFAULT '',
      implements_job_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, job_index)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'collecting',
      role TEXT NOT NULL CHECK(role IN ('user', 'system')),
      message TEXT NOT NULL,
      ready_for_next_stage INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      model_key TEXT NOT NULL,
      model_value TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);
}

function makeMockClient(needed: boolean): OpenCodeServeClient {
  return {
    ensureStarted: async () => undefined,
    createSession: async () => 'session-1',
    sendMessage: async () => ({
      parts: [
        {
          type: 'text',
          text: JSON.stringify({
            needed,
            test_title: 'Test: Impl Job',
            test_description: 'Verifies Impl Job manually.',
            test_plan_markdown: '# Test Plan: Impl Job\n\n## Positive Cases\n- Do human verify'
          })
        }
      ]
    }) as unknown as Awaited<ReturnType<OpenCodeServeClient['sendMessage']>>,
    setSession: () => undefined,
    shutdown: () => undefined,
    deleteSession: async () => undefined,
  } as unknown as OpenCodeServeClient;
}

describe('stage-plan handleTest', () => {
  let db: Database.Database;
  let tempRoot: string;
  let originalGetOrCreate: typeof serveRegistry.getOrCreate;
  let originalSetSession: typeof serveRegistry.setSession;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-plan-test-'));
    process.env.OPENVELO_TEMP_DATA_PATH = tempRoot;

    originalGetOrCreate = serveRegistry.getOrCreate.bind(serveRegistry);
    originalSetSession = serveRegistry.setSession.bind(serveRegistry);
  });

  afterEach(() => {
    serveRegistry.getOrCreate = originalGetOrCreate;
    serveRegistry.setSession = originalSetSession;
    serveRegistry.shutdownAll();
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('generates test job and links dependencies if needed=true', async () => {
    serveRegistry.getOrCreate = (() => makeMockClient(true)) as typeof serveRegistry.getOrCreate;
    serveRegistry.setSession = (() => undefined) as typeof serveRegistry.setSession;

    const chatId = 101;
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (?, 'plan', 1, 'Test Chat', 'plan', 'test')
    `).run(chatId);

    const chatDir = path.join(tempRoot, 'chats', `1-${chatId}`);
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'REPOSITORY.md'), '# Repo context');

    // Seed one implementation job
    insertPlanJob({
      chat_id: chatId,
      job_index: 1,
      title: 'Impl Job',
      description: 'First implementation',
      requirement_line_mapping: '[]'
    });

    const promptsDir = path.join(process.cwd(), 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });

    await handlePlan(chatId);

    // Verify chat transitioned back to plan/plan stage
    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = ?').get(chatId) as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'plan');
    assert.strictEqual(chat.sub_stage, 'plan');

    // Verify test job is created and sequential order is correct
    const planJobs = getPlanJobs(chatId);
    assert.strictEqual(planJobs.length, 2);

    assert.strictEqual(planJobs[0].title, 'Impl Job');
    assert.strictEqual(planJobs[0].job_index, 1);
    assert.strictEqual(planJobs[0].implements_job_id, null);

    assert.strictEqual(planJobs[1].title, 'Test: Impl Job');
    assert.strictEqual(planJobs[1].job_index, 2);
    assert.strictEqual(planJobs[1].implements_job_id, planJobs[0].id);
    assert.strictEqual(planJobs[1].test_plan_markdown, '# Test Plan: Impl Job\n\n## Positive Cases\n- Do human verify');
  });

  it('skips generating test job if needed=false', async () => {
    serveRegistry.getOrCreate = (() => makeMockClient(false)) as typeof serveRegistry.getOrCreate;
    serveRegistry.setSession = (() => undefined) as typeof serveRegistry.setSession;

    const chatId = 102;
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (?, 'plan', 1, 'Test Chat', 'plan', 'test')
    `).run(chatId);

    const chatDir = path.join(tempRoot, 'chats', `1-${chatId}`);
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'REPOSITORY.md'), '# Repo context');

    insertPlanJob({
      chat_id: chatId,
      job_index: 1,
      title: 'Impl Job',
      description: 'First implementation',
      requirement_line_mapping: '[]'
    });

    await handlePlan(chatId);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = ?').get(chatId) as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'plan');
    assert.strictEqual(chat.sub_stage, 'plan');

    const planJobs = getPlanJobs(chatId);
    assert.strictEqual(planJobs.length, 1);
    assert.strictEqual(planJobs[0].title, 'Impl Job');
  });
});
