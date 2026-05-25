import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { resetTestDb, closeDb } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import type { OpenCodeServeClient } from '@/lib/opencode-serve-client';
import { handleVerify, _setLoggerServiceForTest, LoggerServiceLike } from '@/lib/workflow/stage-verify';
import { chatsRouter } from '@/api/routes/chats';
import { transitionTo } from '@/lib/workflow/index';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      password_reset_required INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      port INTEGER NOT NULL DEFAULT 3000,
      repo_host TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL DEFAULT '',
      repo_pat TEXT,
      docker_image TEXT NOT NULL DEFAULT 'openvelo-agent:linux',
      backend TEXT NOT NULL DEFAULT 'opencode',
      default_model TEXT NOT NULL DEFAULT '',
      execution_model TEXT NOT NULL DEFAULT '',
      analyzer_model TEXT NOT NULL DEFAULT '',
      chat_model TEXT NOT NULL DEFAULT '',
      requirement_model TEXT NOT NULL DEFAULT '',
      planning_model TEXT NOT NULL DEFAULT '',
      build_cmd TEXT,
      test_cmd TEXT,
      staging_branch TEXT NOT NULL DEFAULT 'staging',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL DEFAULT 'plan',
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'init',
      sub_stage TEXT NOT NULL DEFAULT '',
      running INTEGER NOT NULL DEFAULT 0,
      sub_stage_pre_error TEXT,
      error_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chat_sessions(id)
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

function createVerifyChat(db: Database.Database, chatId: number, projectId: number, subStage: string = 'upload'): void {
  db.prepare(`
    INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
    VALUES (?, 'verify', ?, 'Test Verify Chat', 'verify', ?)
  `).run(chatId, projectId, subStage);
}

function createProject(db: Database.Database, projectId: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, default_model)
    VALUES (?, 'Test Project', 'test-default-model')
  `).run(projectId);
  db.prepare(`
    INSERT OR REPLACE INTO project_models (project_id, model_key, model_value)
    VALUES (?, 'analyzer_model', 'test-analyzer')
  `).run(projectId);
}

const tempDirs: string[] = [];

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
    } catch (_e) { }
  }
  tempDirs.length = 0;
}

describe('stage-verify handler', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.OPENVELO_TEMP_DATA_PATH = path.join(process.cwd(), 'temp_data');
    fs.mkdirSync(process.env.OPENVELO_TEMP_DATA_PATH, { recursive: true });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
    cleanupTempDirs();
    serveRegistry.shutdownAll();
  });

  afterEach(() => {
    cleanupTempDirs();
    _setLoggerServiceForTest(null);
  });

  it('returns early when sub_stage is upload', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'upload');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.sub_stage, 'upload');
  });

  it('returns early when sub_stage is satisfied (terminal)', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'satisfied');

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.sub_stage, 'satisfied');
  });

  it('returns early when sub_stage is error', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'error');

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.sub_stage, 'error');
  });

  it('transitions to error when chat dir or repo dir is missing', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    fs.mkdirSync(chatDir, { recursive: true });

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'error');
  });

  it('transitions to error when project is not found', async () => {
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT OR REPLACE INTO chat_sessions (id, mode, project_id, name, stage, sub_stage)
      VALUES (1, 'verify', 999, 'Test Verify Chat', 'verify', 'analysis')
    `).run();

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'error');
  });

  it('transitions to satisfied when LLM returns { "satisfied": true }', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: '{ "satisfied": true }' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'satisfied');
  });

  it('transitions to requirement/requirement when LLM returns { "satisfied": false } and REQUIREMENT.md exists', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    fs.writeFileSync(path.join(chatDir, 'REQUIREMENT.md'), '## Unsatisfied Requirements\n- Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: '{ "satisfied": false }' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'requirement');
    assert.strictEqual(chat.sub_stage, 'requirement');
  });

  it('uses regex fallback to extract satisfied from markdown code fence JSON', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: '```json\n{ "satisfied": true }\n```' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'satisfied');
  });

  it('transitions to error when LLM response is unparseable', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: 'This is not JSON at all' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'error');
  });

  it('transitions to error when satisfied field is not a boolean', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: '{ "satisfied": "yes" }' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'error');
  });

  it('transitions to error when satisfied=false but REQUIREMENT.md is missing', async () => {
    createProject(db, 1);
    createVerifyChat(db, 1, 1, 'analysis');

    const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
    const repoDir = path.join(chatDir, 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
    tempDirs.push(chatDir);

    const mockClient = {
      ensureStarted: async () => { },
      createSession: async () => 'session-1',
      sendMessage: async () => ({
        parts: [{ type: 'text', text: '{ "satisfied": false }' }]
      })
    };
    /* eslint-disable @typescript-eslint/no-unused-vars */
    serveRegistry.getOrCreate = (
      _chatId: number,
      _chatDir: string,
      _env: Record<string, string | undefined>
    ) => mockClient as unknown as OpenCodeServeClient;

    await handleVerify(1);

    const chat = db.prepare('SELECT stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string };
    assert.strictEqual(chat.stage, 'verify');
    assert.strictEqual(chat.sub_stage, 'error');
  });

  describe('logger streaming', () => {
    it('emits appendVerbose with workflow:verify prefix at each key step on satisfied path', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      tempDirs.push(chatDir);

      const logs: Array<{ prefix: string; message: string }> = [];
      const mockLogger: LoggerServiceLike = {
        appendVerbose(chatId: number, prefix: string, message: string) {
          logs.push({ prefix, message });
        },
        clearChat(_chatId: number) {},
        append(_chatId: number, _line: string) {},
      };
      _setLoggerServiceForTest(mockLogger);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: '{ "satisfied": true }' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const prefixes = logs.map(l => l.prefix);
      assert.ok(prefixes.every(p => p === 'workflow:verify'), `All prefixes should be workflow:verify, got: ${JSON.stringify(prefixes)}`);

      const messages = logs.map(l => l.message);
      assert.ok(messages.includes('Starting verify analysis'), `Expected 'Starting verify analysis', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('OpenCode session created'), `Expected 'OpenCode session created', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('Loading verify prompt'), `Expected 'Loading verify prompt', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('ORIGINAL_REQUIREMENT.md read successfully'), `Expected 'ORIGINAL_REQUIREMENT.md read successfully', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.some(m => m.startsWith('Sending verify prompt')), `Expected 'Sending verify prompt', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('LLM response received'), `Expected 'LLM response received', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('Verdict: satisfied'), `Expected 'Verdict: satisfied', got: ${JSON.stringify(messages)}`);
    });

    it('emits appendVerbose with workflow:verify prefix at each key step on unsatisfied path', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      fs.writeFileSync(path.join(chatDir, 'REQUIREMENT.md'), '## Unsatisfied Requirements\n- Test');
      tempDirs.push(chatDir);

      const logs: Array<{ prefix: string; message: string }> = [];
      const mockLogger: LoggerServiceLike = {
        appendVerbose(chatId: number, prefix: string, message: string) {
          logs.push({ prefix, message });
        },
        clearChat(_chatId: number) {},
        append(_chatId: number, _line: string) {},
      };
      _setLoggerServiceForTest(mockLogger);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: '{ "satisfied": false }' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const messages = logs.map(l => l.message);
      assert.ok(messages.includes('Verdict: unsatisfied'), `Expected 'Verdict: unsatisfied', got: ${JSON.stringify(messages)}`);
      assert.ok(messages.includes('REQUIREMENT.md generated, transitioning to requirement stage'), `Expected 'REQUIREMENT.md generated, transitioning to requirement stage', got: ${JSON.stringify(messages)}`);
    });

    it('emits Parse failure log when LLM response is unparseable', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      tempDirs.push(chatDir);

      const logs: Array<{ prefix: string; message: string }> = [];
      const mockLogger: LoggerServiceLike = {
        appendVerbose(chatId: number, prefix: string, message: string) {
          logs.push({ prefix, message });
        },
        clearChat(_chatId: number) {},
        append(_chatId: number, _line: string) {},
      };
      _setLoggerServiceForTest(mockLogger);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: 'not json at all' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const messages = logs.map(l => l.message);
      assert.ok(messages.includes('Parse failure - unparseable response'), `Expected 'Parse failure - unparseable response', got: ${JSON.stringify(messages)}`);
    });

    it('calls clearChat when re-entering analysis sub-stage', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      tempDirs.push(chatDir);

      let clearChatCalled = false;
      let clearChatId: number | null = null;
      const mockLogger: LoggerServiceLike = {
        appendVerbose(chatId: number, prefix: string, message: string) {},
        clearChat(chatId: number) {
          clearChatCalled = true;
          clearChatId = chatId;
        },
        append(_chatId: number, _line: string) {},
      };
      _setLoggerServiceForTest(mockLogger);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: '{ "satisfied": true }' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      assert.strictEqual(clearChatCalled, true, 'clearChat should be called');
      assert.strictEqual(clearChatId, 1, 'clearChat should be called with chatId 1');
    });
  });

  describe('transitionTo with verify/analysis', () => {
    const originalSetImmediate = globalThis.setImmediate;
    const timers: Array<{ type: string; fn: unknown }> = [];

    beforeEach(() => {
      timers.length = 0;
      globalThis.setImmediate = ((fn: unknown, ...args: unknown[]) => {
        timers.push({ type: 'setImmediate', fn });
        return originalSetImmediate(fn as Parameters<typeof setImmediate>[0], ...args);
      }) as typeof setImmediate;
    });

    afterEach(() => {
      globalThis.setImmediate = originalSetImmediate;
    });

    it('transitionTo to verify/analysis calls runWorkflow via setImmediate', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'upload');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(chatDir, { recursive: true });

      transitionTo(1, 'verify', 'analysis');

      const workflowCallback = timers.find(t => {
        const fnStr = (t.fn as unknown as { toString(): string }).toString();
        return fnStr.includes('runWorkflow');
      });

      assert.ok(workflowCallback !== undefined, 'setImmediate should be called with runWorkflow callback');
      assert.strictEqual(timers.length, 1, 'only one setImmediate should be scheduled for verify/analysis');
    });

    it('transitionTo to verify/upload does NOT call runWorkflow', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'init');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(chatDir, { recursive: true });

      transitionTo(1, 'verify', 'upload');

      const workflowCallback = timers.find(t => {
        const fnStr = (t.fn as unknown as { toString(): string }).toString();
        return fnStr.includes('runWorkflow');
      });

      assert.ok(workflowCallback === undefined, 'setImmediate should NOT be called for verify/upload');
    });

    it('transitionTo to verify/satisfied does NOT call runWorkflow', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(chatDir, { recursive: true });

      transitionTo(1, 'verify', 'satisfied');

      const workflowCallback = timers.find(t => {
        const fnStr = (t.fn as unknown as { toString(): string }).toString();
        return fnStr.includes('runWorkflow');
      });

      assert.ok(workflowCallback === undefined, 'setImmediate should NOT be called for verify/satisfied');
    });

    it('transitionTo to verify/error does NOT call runWorkflow', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(chatDir, { recursive: true });

      transitionTo(1, 'verify', 'error');

      const workflowCallback = timers.find(t => {
        const fnStr = (t.fn as unknown as { toString(): string }).toString();
        return fnStr.includes('runWorkflow');
      });

      assert.ok(workflowCallback === undefined, 'setImmediate should NOT be called for verify/error');
    });
  });

  describe('error_type classification for failure paths', () => {
    const originalReadFileSync = fs.readFileSync;

    beforeEach(() => {
      tempDirs.length = 0;
    });

    afterEach(() => {
      fs.readFileSync = originalReadFileSync;
      tempDirs.length = 0;
    });

    it('transitions to error with session_start_failure when createSession throws', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => { throw new Error('network error'); },
        sendMessage: async () => ({ parts: [{ type: 'text', text: '{}' }] })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const chat = db.prepare('SELECT stage, sub_stage, error_type FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; error_type: string };
      assert.strictEqual(chat.stage, 'verify');
      assert.strictEqual(chat.sub_stage, 'error');
      assert.strictEqual(chat.error_type, 'session_start_failure');
    });

    it('transitions to error with missing_original_requirement when ORIGINAL_REQUIREMENT.md read fails', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      tempDirs.push(chatDir);

      fs.readFileSync = ((
        filePath: string | Buffer | URL,
        options?: { encoding?: null; flag?: string } | null
      ) => {
        const p = filePath.toString();
        if (p.endsWith('ORIGINAL_REQUIREMENT.md')) {
          throw new Error('EACCES: permission denied');
        }
        return originalReadFileSync(filePath, options);
      }) as typeof fs.readFileSync;

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({ parts: [{ type: 'text', text: '{}' }] })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const chat = db.prepare('SELECT stage, sub_stage, error_type FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; error_type: string };
      assert.strictEqual(chat.stage, 'verify');
      assert.strictEqual(chat.sub_stage, 'error');
      assert.strictEqual(chat.error_type, 'missing_original_requirement');
    });

    it('transitions to error with unknown when prompt template read fails', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      tempDirs.push(chatDir);

      fs.readFileSync = ((
        filePath: string | Buffer | URL,
        options?: { encoding?: null; flag?: string } | null
      ) => {
        const p = filePath.toString();
        if (p.endsWith('verify-analysis.md')) {
          throw new Error('ENOENT: no such file or directory');
        }
        return originalReadFileSync(filePath, options);
      }) as typeof fs.readFileSync;

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({ parts: [{ type: 'text', text: '{}' }] })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const chat = db.prepare('SELECT stage, sub_stage, error_type FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; error_type: string };
      assert.strictEqual(chat.stage, 'verify');
      assert.strictEqual(chat.sub_stage, 'error');
      assert.strictEqual(chat.error_type, 'unknown');
    });

    it('transitions to error with missing_requirement_file when REQUIREMENT.md is whitespace only', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      fs.writeFileSync(path.join(chatDir, 'REQUIREMENT.md'), '   \n\t  \n');
      tempDirs.push(chatDir);

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: '{ "satisfied": false }' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const chat = db.prepare('SELECT stage, sub_stage, error_type FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; error_type: string };
      assert.strictEqual(chat.stage, 'verify');
      assert.strictEqual(chat.sub_stage, 'error');
      assert.strictEqual(chat.error_type, 'missing_requirement_file');
    });

    it('transitions to error with missing_requirement_file when REQUIREMENT.md read fails', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'analysis');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test requirement');
      fs.writeFileSync(path.join(chatDir, 'REQUIREMENT.md'), 'some content');
      tempDirs.push(chatDir);

      fs.readFileSync = ((
        filePath: string | Buffer | URL,
        options?: { encoding?: null; flag?: string } | null
      ) => {
        const p = filePath.toString();
        if (p.endsWith('/REQUIREMENT.md') || p.endsWith('\\REQUIREMENT.md') || p === 'REQUIREMENT.md') {
          throw new Error('EACCES: permission denied');
        }
        return originalReadFileSync(filePath, options);
      }) as typeof fs.readFileSync;

      const mockClient = {
        ensureStarted: async () => {},
        createSession: async () => 'session-1',
        sendMessage: async () => ({
          parts: [{ type: 'text', text: '{ "satisfied": false }' }]
        })
      };
      serveRegistry.getOrCreate = (
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => mockClient as unknown as OpenCodeServeClient;

      await handleVerify(1);

      const chat = db.prepare('SELECT stage, sub_stage, error_type FROM chat_sessions WHERE id = 1').get() as { stage: string; sub_stage: string; error_type: string };
      assert.strictEqual(chat.stage, 'verify');
      assert.strictEqual(chat.sub_stage, 'error');
      assert.strictEqual(chat.error_type, 'missing_requirement_file');
    });
  });

  describe('POST /:chatId/verify/retry endpoint', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = { id: 1, username: 'admin', role: 'admin', enabled: true };
        next();
      });
      app.use('/api/chats', chatsRouter);
    });

    it('returns 404 when chat does not exist', async () => {
      const request = supertest(app);
      const res = await request.post('/api/chats/999/verify/retry');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Chat session not found');
    });

    it('sets running=false and transitions to sub_stage_pre_error', async () => {
      createProject(db, 1);
      createVerifyChat(db, 1, 1, 'error');

      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(path.join(chatDir, 'repository'), { recursive: true });
      tempDirs.push(chatDir);

      db.prepare('UPDATE chat_sessions SET sub_stage_pre_error = ? WHERE id = 1').run('analysis');

      serveRegistry.getOrCreate = (
        /* eslint-disable @typescript-eslint/no-unused-vars */
        _chatId: number,
        _chatDir: string,
        _env: Record<string, string | undefined>
      ) => {
        const mockClient = {
          ensureStarted: async () => { throw new Error('no server'); },
          createSession: async () => 'session',
          sendMessage: async () => ({ parts: [{ type: 'text', text: '{}' }] })
        };
        return mockClient as unknown as OpenCodeServeClient;
      };

      const request = supertest(app);
      const res = await request.post('/api/chats/1/verify/retry');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const chatBefore = db.prepare('SELECT running, stage, sub_stage FROM chat_sessions WHERE id = 1').get() as { running: number; stage: string; sub_stage: string };
      assert.strictEqual(chatBefore.stage, 'verify');
      assert.strictEqual(chatBefore.sub_stage, 'analysis');
    });
  });
});