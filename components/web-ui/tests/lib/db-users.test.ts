import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after, beforeEach } from 'node:test';
import { initDb, resetTestDb, closeDb, createUser, getUserById, getUserByUsername, getAllUsers, updateUser, countEnabledAdmins, setPasswordResetRequired } from '@/lib/db';

describe('db.ts user CRUD functions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  after(() => {
    closeDb();
  });

  it('createUser inserts a user and returns the full User object', () => {
    const user = createUser({
      username: 'testuser',
      password_hash: 'hash123',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    assert.strictEqual(user.username, 'testuser');
    assert.strictEqual(user.password_hash, 'hash123');
    assert.strictEqual(user.role, 'user');
    assert.strictEqual(user.enabled, true);
    assert.strictEqual(user.password_reset_required, false);
    assert.strictEqual(typeof user.id, 'number');
    assert.ok(user.created_at);
    assert.ok(user.updated_at);
  });

  it('getUserByUsername finds user case-insensitively', () => {
    createUser({
      username: 'Admin',
      password_hash: 'hash',
      role: 'admin',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    const user = getUserByUsername('admin');
    assert.ok(user, 'should find Admin when querying admin');
    assert.strictEqual(user!.username, 'Admin');
  });

  it('getUserByUsername returns undefined for non-existent user', () => {
    const user = getUserByUsername('nonexistent');
    assert.strictEqual(user, undefined);
  });

  it('getUserById returns user by id', () => {
    const created = createUser({
      username: 'byid',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    const found = getUserById(created.id);
    assert.ok(found);
    assert.strictEqual(found!.username, 'byid');
  });

  it('getUserById returns undefined for non-existent id', () => {
    const user = getUserById(99999);
    assert.strictEqual(user, undefined);
  });

  it('getAllUsers returns all users', () => {
    createUser({ username: 'user1', password_hash: 'h1', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    createUser({ username: 'user2', password_hash: 'h2', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    const users = getAllUsers();
    assert.strictEqual(users.length, 2);
  });

  it('updateUser role updates the user role', () => {
    const user = createUser({
      username: 'updateme',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    const updated = updateUser(user.id, { role: 'admin' });
    assert.ok(updated);
    assert.strictEqual(updated!.role, 'admin');
  });

  it('updateUser returns undefined for non-existent id', () => {
    const result = updateUser(99999, { role: 'admin' });
    assert.strictEqual(result, undefined);
  });

  it('countEnabledAdmins returns 0 when no admins exist', () => {
    createUser({ username: 'u1', password_hash: 'h', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    createUser({ username: 'u2', password_hash: 'h', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    assert.strictEqual(countEnabledAdmins(), 0);
  });

  it('countEnabledAdmins returns 2 when two admins exist', () => {
    createUser({ username: 'admin1', password_hash: 'h', role: 'admin', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    createUser({ username: 'admin2', password_hash: 'h', role: 'admin', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    createUser({ username: 'user1', password_hash: 'h', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    assert.strictEqual(countEnabledAdmins(), 2);
  });

  it('countEnabledAdmins does not count disabled admins', () => {
    createUser({ username: 'enabled', password_hash: 'h', role: 'admin', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    createUser({ username: 'disabled', password_hash: 'h', role: 'admin', enabled: false, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    assert.strictEqual(countEnabledAdmins(), 1);
  });

  it('setPasswordResetRequired updates the flag to true', () => {
    const user = createUser({
      username: 'resetflag',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    setPasswordResetRequired(user.id, true);
    const found = getUserById(user.id);
    assert.strictEqual(found!.password_reset_required, true);
  });

  it('setPasswordResetRequired updates the flag to false', () => {
    const user = createUser({
      username: 'resetflag2',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: true,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    setPasswordResetRequired(user.id, false);
    const found = getUserById(user.id);
    assert.strictEqual(found!.password_reset_required, false);
  });

  it('integer columns enabled and password_reset_required map to booleans', () => {
    const user = createUser({
      username: 'booltest',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: true,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    assert.strictEqual(typeof user.enabled, 'boolean');
    assert.strictEqual(typeof user.password_reset_required, 'boolean');
    assert.strictEqual(user.enabled, true);
    assert.strictEqual(user.password_reset_required, true);
  });
});