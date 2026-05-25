import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { resetTestDb, getProjectModels } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, role TEXT, enabled INTEGER DEFAULT 1, password_reset_required INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT UNIQUE, default_model TEXT DEFAULT '', analyzer_model TEXT DEFAULT '', port INTEGER DEFAULT 3000, repo_host TEXT DEFAULT 'github', repo_url TEXT DEFAULT '', docker_image TEXT DEFAULT 'openvelo-agent:linux', backend TEXT DEFAULT 'opencode');
    CREATE TABLE IF NOT EXISTS chat_sessions (id INTEGER PRIMARY KEY, mode TEXT, project_id INTEGER, name TEXT, stage TEXT DEFAULT 'init', sub_stage TEXT DEFAULT '');
  `);
}

const tempDirs: string[] = [];

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
}

describe('verify-session', () => {
  let db: Database.Database;
  const projectId = 1;

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
  });

  describe('getProjectModels behavior', () => {
    it('throws when default_model is empty', () => {
      db.prepare(`INSERT INTO projects (id, name, default_model, analyzer_model) VALUES (?, ?, '', '')`).run(projectId, 'Test Project');

      let threw = false;
      let msg = '';
      try {
        getProjectModels(projectId);
      } catch (e) {
        threw = true;
        msg = e instanceof Error ? e.message : String(e);
      }
      assert.strictEqual(threw, true);
      assert.ok(msg.includes('default_model'), `Expected default_model error, got: ${msg}`);
    });

    it('returns analyzer_model when configured', () => {
      db.prepare(`INSERT INTO projects (id, name, default_model, analyzer_model) VALUES (?, ?, 'default-val', 'analyzer-val')`).run(projectId, 'Test Project');

      const models = getProjectModels(projectId);
      assert.strictEqual(models.analyzer_model, 'analyzer-val');
    });

    it('falls back analyzer_model to default_model when not set', () => {
      db.prepare(`INSERT INTO projects (id, name, default_model, analyzer_model) VALUES (?, ?, 'fallback-model', '')`).run(projectId, 'Test Project');

      const models = getProjectModels(projectId);
      assert.strictEqual(models.analyzer_model, 'fallback-model');
    });
  });

  describe('serveRegistry.setSession', () => {
    it('stores session id for a given stage', () => {
      serveRegistry.setSession(1, 'verify', 'session-abc');
      const id = serveRegistry.getSession(1, 'verify');
      assert.strictEqual(id, 'session-abc');
    });

    it('overwrites previous session id for same stage', () => {
      serveRegistry.setSession(1, 'verify', 'session-1');
      serveRegistry.setSession(1, 'verify', 'session-2');
      assert.strictEqual(serveRegistry.getSession(1, 'verify'), 'session-2');
    });

    it('returns null for non-existent chat', () => {
      assert.strictEqual(serveRegistry.getSession(999, 'verify'), null);
    });

    it('different stages have independent sessions', () => {
      serveRegistry.setSession(1, 'verify', 'verify-session');
      serveRegistry.setSession(1, 'analyzing', 'analyze-session');
      assert.strictEqual(serveRegistry.getSession(1, 'verify'), 'verify-session');
      assert.strictEqual(serveRegistry.getSession(1, 'analyzing'), 'analyze-session');
    });

    it('setSession with empty string clears the session', () => {
      serveRegistry.setSession(1, 'verify', 'active-session');
      assert.strictEqual(serveRegistry.getSession(1, 'verify'), 'active-session');
      serveRegistry.setSession(1, 'verify', '');
      assert.strictEqual(serveRegistry.getSession(1, 'verify'), null);
    });
  });

  describe('serveRegistry.getClient', () => {
    it('returns undefined for non-existent chat', () => {
      const client = serveRegistry.getClient(999);
      assert.strictEqual(client, undefined);
    });
  });

  describe('serveRegistry.shutdownAll', () => {
    it('clears all entries', () => {
      const chatDir = path.join(process.env.OPENVELO_TEMP_DATA_PATH, 'chats', '1-1');
      fs.mkdirSync(chatDir, { recursive: true });
      tempDirs.push(chatDir);

      const client = serveRegistry.getOrCreate(1, chatDir, process.env);
      assert.ok(client);

      serveRegistry.shutdownAll();

      const afterClient = serveRegistry.getClient(1);
      assert.strictEqual(afterClient, undefined);
    });
  });
});