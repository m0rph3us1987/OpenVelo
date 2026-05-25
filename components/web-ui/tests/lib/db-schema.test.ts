import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after, beforeEach } from 'node:test';
import { initDb, resetTestDb, closeDb } from '@/lib/db';

describe('db.ts schema migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  after(() => {
    closeDb();
  });

  it('creates users table with correct schema', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    assert.ok(table, 'users table should exist');

    const info = db.prepare("PRAGMA table_info(users)").all() as { name: string; notnull: number }[];
    const columns = info.map(c => c.name);

    assert.ok(columns.includes('id'), 'users should have id column');
    assert.ok(columns.includes('username'), 'users should have username column');
    assert.ok(columns.includes('password_hash'), 'users should have password_hash column');
    assert.ok(columns.includes('role'), 'users should have role column');
    assert.ok(columns.includes('enabled'), 'users should have enabled column');
    assert.ok(columns.includes('password_reset_required'), 'users should have password_reset_required column');
    assert.ok(columns.includes('created_at'), 'users should have created_at column');
    assert.ok(columns.includes('updated_at'), 'users should have updated_at column');

    const usernameCol = info.find(c => c.name === 'username');
    assert.ok(usernameCol, 'username column should exist');
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string };
    assert.ok(sql.sql.includes('COLLATE NOCASE'), 'username should have COLLATE NOCASE');
  });

  it('creates groups table with correct schema', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'").get();
    assert.ok(table, 'groups table should exist');

    const info = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
    const columns = info.map(c => c.name);

    assert.ok(columns.includes('id'), 'groups should have id column');
    assert.ok(columns.includes('name'), 'groups should have name column');
    assert.ok(columns.includes('description'), 'groups should have description column');
    assert.ok(columns.includes('created_at'), 'groups should have created_at column');
    assert.ok(columns.includes('updated_at'), 'groups should have updated_at column');
  });

  it('creates group_members table with correct schema', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_members'").get();
    assert.ok(table, 'group_members table should exist');

    const info = db.prepare("PRAGMA table_info(group_members)").all() as { name: string }[];
    const columns = info.map(c => c.name);

    assert.ok(columns.includes('group_id'), 'group_members should have group_id column');
    assert.ok(columns.includes('user_id'), 'group_members should have user_id column');
  });

  it('creates group_projects table with correct schema', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_projects'").get();
    assert.ok(table, 'group_projects table should exist');

    const info = db.prepare("PRAGMA table_info(group_projects)").all() as { name: string }[];
    const columns = info.map(c => c.name);

    assert.ok(columns.includes('group_id'), 'group_projects should have group_id column');
    assert.ok(columns.includes('project_id'), 'group_projects should have project_id column');
  });

  it('removes password key from ui_settings', () => {
    const row = db.prepare("SELECT value FROM ui_settings WHERE key = 'password'").get();
    assert.strictEqual(row, undefined, 'password key should not exist in ui_settings');
  });

  it('sets security_enabled to false in ui_settings', () => {
    const row = db.prepare("SELECT value FROM ui_settings WHERE key = 'security_enabled'").get() as { value: string } | undefined;
    assert.ok(row, 'security_enabled key should exist in ui_settings');
    assert.strictEqual(row.value, 'false', 'security_enabled should be false');
  });
});