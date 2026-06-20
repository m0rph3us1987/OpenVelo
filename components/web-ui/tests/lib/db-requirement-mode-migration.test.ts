import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after } from 'node:test';
import { migrateChatSessionsMode, closeDb } from '@/lib/db';

function buildOldSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL
    );
    CREATE TABLE chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify')),
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
    CREATE TABLE plan_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO projects (name, port) VALUES ('p1', 1)`).run();
  db.prepare(`INSERT INTO chat_sessions (mode, project_id, name) VALUES ('plan', 1, 'c1')`).run();
  db.prepare(`INSERT INTO plan_stories (chat_id, title) VALUES (1, 'story 1')`).run();
}

function buildBrokenFkSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL
    );
    CREATE TABLE chat_sessions (
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
    CREATE TABLE plan_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES "chat_sessions__legacy"(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO projects (name, port) VALUES ('p1', 1)`).run();
  db.prepare(`INSERT INTO chat_sessions (mode, project_id, name) VALUES ('plan', 1, 'c1')`).run();
  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO plan_stories (chat_id, title) VALUES (1, 'story 1')`).run();
  db.pragma('foreign_keys = ON');
}

describe('migrateChatSessionsMode', () => {
  after(() => {
    closeDb();
  });

  it('widens the CHECK constraint and rebuilds child FKs on a fresh DB', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    buildOldSchema(db);

    migrateChatSessionsMode(db);

    const chatSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_sessions'`
    ).get() as { sql: string };
    assert.ok(
      chatSql.sql.includes("'requirement'"),
      'chat_sessions CHECK should include requirement'
    );
    assert.ok(
      !chatSql.sql.includes("chat_sessions__legacy"),
      'chat_sessions schema should not reference the legacy name'
    );

    const storiesSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string };
    assert.ok(
      storiesSql.sql.includes('REFERENCES chat_sessions('),
      'plan_stories FK should reference chat_sessions'
    );
    assert.ok(
      !storiesSql.sql.includes('chat_sessions__legacy'),
      'plan_stories FK should not reference the dropped table'
    );

    const rowCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_stories').get() as { c: number }).c;
    assert.strictEqual(rowCount, 1, 'plan_stories data should be preserved');

    assert.doesNotThrow(() => {
      db.prepare('DELETE FROM plan_stories WHERE chat_id = ?').run(1);
    });

    db.close();
  });

  it('repairs child tables whose FKs still reference chat_sessions__legacy', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    buildBrokenFkSchema(db);

    migrateChatSessionsMode(db);

    const storiesSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string };
    assert.ok(
      storiesSql.sql.includes('REFERENCES chat_sessions('),
      'plan_stories FK should be repointed at chat_sessions'
    );
    assert.ok(
      !storiesSql.sql.includes('chat_sessions__legacy'),
      'plan_stories FK should no longer reference the dropped table'
    );

    const rowCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_stories').get() as { c: number }).c;
    assert.strictEqual(rowCount, 1, 'plan_stories data should be preserved across rebuild');

    assert.doesNotThrow(() => {
      db.prepare('DELETE FROM plan_stories WHERE chat_id = ?').run(1);
    });

    db.close();
  });

  it('repairs child tables whose FKs reference an orphan __rebuild_fk table', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        port INTEGER NOT NULL
      );
      CREATE TABLE plan_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE chat_sessions (
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
      CREATE TABLE plan_stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        feature_id INTEGER NOT NULL REFERENCES "plan_features__rebuild_fk"(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      );
    `);
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO projects (name, port) VALUES ('p1', 1)`).run();
    db.prepare(`INSERT INTO plan_features (chat_id, title) VALUES (1, 'f1')`).run();
    db.prepare(`INSERT INTO chat_sessions (mode, project_id, name) VALUES ('plan', 1, 'c1')`).run();
    db.prepare(`INSERT INTO plan_stories (chat_id, feature_id, title) VALUES (1, 1, 'story 1')`).run();
    db.pragma('foreign_keys = ON');

    migrateChatSessionsMode(db);

    const storiesSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string };
    assert.ok(
      /REFERENCES\s+(?:"plan_features"|plan_features)\(/.test(storiesSql.sql),
      `plan_stories FK should be repointed at plan_features, got: ${storiesSql.sql}`
    );
    assert.ok(
      !storiesSql.sql.includes('__rebuild_fk'),
      `plan_stories FK should no longer reference __rebuild_fk, got: ${storiesSql.sql}`
    );

    const rowCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_stories').get() as { c: number }).c;
    assert.strictEqual(rowCount, 1, 'plan_stories data should be preserved across rebuild');

    assert.doesNotThrow(() => {
      db.prepare('DELETE FROM plan_stories WHERE chat_id = ?').run(1);
    });

    db.close();
  });

  it('rebuilds sibling tables in dependency order so cross-table FKs are repointed correctly', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        port INTEGER NOT NULL
      );
      CREATE TABLE chat_sessions (
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
      CREATE TABLE plan_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      );
      CREATE TABLE plan_stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        feature_id INTEGER NOT NULL REFERENCES "plan_features__rebuild_fk"(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      );
    `);
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO projects (name, port) VALUES ('p1', 1)`).run();
    db.prepare(`INSERT INTO chat_sessions (mode, project_id, name) VALUES ('plan', 1, 'c1')`).run();
    db.prepare(`INSERT INTO plan_features (chat_id, title) VALUES (1, 'f1')`).run();
    db.prepare(`INSERT INTO plan_stories (chat_id, feature_id, title) VALUES (1, 1, 's1')`).run();
    db.pragma('foreign_keys = ON');

    assert.doesNotThrow(() => migrateChatSessionsMode(db));

    const featuresSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_features'`
    ).get() as { sql: string } | undefined;
    const storiesSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string } | undefined;
    assert.ok(featuresSql, 'plan_features should exist');
    assert.ok(storiesSql, 'plan_stories should exist');
    assert.ok(!featuresSql.sql.includes('__rebuild_fk'), 'plan_features should not have rebuild suffix');
    assert.ok(!storiesSql.sql.includes('__rebuild_fk'), 'plan_stories should not have rebuild suffix');
    assert.ok(/REFERENCES\s+(?:"plan_features"|plan_features)\(/.test(storiesSql.sql), 'plan_stories should reference plan_features');
    assert.ok(/REFERENCES\s+chat_sessions\(/.test(storiesSql.sql), 'plan_stories should reference chat_sessions');

    assert.strictEqual(
      (db.prepare('SELECT COUNT(*) AS c FROM plan_features').get() as { c: number }).c, 1,
      'plan_features data preserved'
    );
    assert.strictEqual(
      (db.prepare('SELECT COUNT(*) AS c FROM plan_stories').get() as { c: number }).c, 1,
      'plan_stories data preserved'
    );

    db.close();
  });

  it('is idempotent on an already-migrated DB', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    buildOldSchema(db);

    migrateChatSessionsMode(db);
    const before = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string };

    assert.doesNotThrow(() => migrateChatSessionsMode(db));

    const after = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='plan_stories'`
    ).get() as { sql: string };
    assert.strictEqual(after.sql, before.sql, 'plan_stories schema should be unchanged');

    db.close();
  });
});
