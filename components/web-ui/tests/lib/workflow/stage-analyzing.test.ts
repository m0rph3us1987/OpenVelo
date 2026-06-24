import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { resetTestDb } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import type { OpenCodeServeClient } from '@/lib/opencode-serve-client';
import { handleAnalyzing } from '@/lib/workflow/stage-analyzing';

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
  `);
}

function makeMockClient(): OpenCodeServeClient {
  return {
    ensureStarted: async () => undefined,
    createSession: async () => 'session-1',
    sendMessage: async () => ({ ok: true, data: {} }) as unknown as Awaited<ReturnType<OpenCodeServeClient['sendMessage']>>,
    setSession: () => undefined,
    shutdown: () => undefined,
  } as unknown as OpenCodeServeClient;
}

describe('stage-analyzing mode branch', () => {
  let db: Database.Database;
  let tempRoot: string;
  let originalGetOrCreate: typeof serveRegistry.getOrCreate;
  let originalSetSession: typeof serveRegistry.setSession;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-analyzing-'));
    process.env.OPENVELO_TEMP_DATA_PATH = tempRoot;

    originalGetOrCreate = serveRegistry.getOrCreate.bind(serveRegistry);
    originalSetSession = serveRegistry.setSession.bind(serveRegistry);
    serveRegistry.getOrCreate = (() => makeMockClient()) as typeof serveRegistry.getOrCreate;
    serveRegistry.setSession = (() => undefined) as typeof serveRegistry.setSession;
  });

  afterEach(() => {
    serveRegistry.getOrCreate = originalGetOrCreate;
    serveRegistry.setSession = originalSetSession;
    serveRegistry.shutdownAll();
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  async function runForMode(mode: 'plan' | 'requirement', chatId: number): Promise<{ stage: string; subStage: string }> {
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (?, ?, 1, 'Test Chat', 'analyzing', 'analyzing')
    `).run(chatId, mode);

    const chatDir = path.join(tempRoot, 'chats', `1-${chatId}`);
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'REPOSITORY.md'), '# Repo context');

    await handleAnalyzing(chatId);

    const row = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = ?').get(chatId) as { stage: string; sub_stage: string };
    return { stage: row.stage, subStage: row.sub_stage };
  }

  it('mode=requirement transitions to verify/upload', async () => {
    const { stage, subStage } = await runForMode('requirement', 11);
    assert.strictEqual(stage, 'verify');
    assert.strictEqual(subStage, 'upload');
  });

  it('mode=plan transitions to collecting/new (no regression)', async () => {
    const { stage, subStage } = await runForMode('plan', 13);
    assert.strictEqual(stage, 'collecting');
    assert.strictEqual(subStage, 'new');
  });
});
