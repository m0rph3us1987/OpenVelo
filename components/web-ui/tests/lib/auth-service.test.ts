import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { initDb, resetTestDb, createUser } from '@/lib/db';
import { authenticateUser, getLoginDelay } from '@/lib/auth-service';
import Database from 'better-sqlite3';

describe('authenticateUser', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  it('returns user with resetRequired false for correct password', async () => {
    const hash = await bcrypt.hash('correctpassword', 10);
    createUser({
      username: 'Admin',
      password_hash: hash,
      role: 'admin',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });

    const result = await authenticateUser('Admin', 'correctpassword');
    assert.ok(result);
    assert.strictEqual(result.user.username, 'Admin');
    assert.strictEqual(result.resetRequired, false);
  });

  it('returns user with resetRequired true when flag is set', async () => {
    const hash = await bcrypt.hash('correctpassword', 10);
    createUser({
      username: 'Admin',
      password_hash: hash,
      role: 'admin',
      enabled: true,
      password_reset_required: true,
      failed_attempts: 0,
      last_failed_attempt: null,
    });

    const result = await authenticateUser('Admin', 'correctpassword');
    assert.ok(result);
    assert.strictEqual(result.resetRequired, true);
  });

  it('returns null for incorrect password', async () => {
    const hash = await bcrypt.hash('correctpassword', 10);
    createUser({
      username: 'Admin',
      password_hash: hash,
      role: 'admin',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });

    const result = await authenticateUser('Admin', 'wrongpassword');
    assert.strictEqual(result, null);
  });

  it('returns null for non-existent user', async () => {
    const result = await authenticateUser('nonexistent', 'anypassword');
    assert.strictEqual(result, null);
  });
});

describe('getLoginDelay', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  it('returns 1000 for first attempt', () => {
    createUser({
      username: 'newuser',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    const delay = getLoginDelay('newuser');
    assert.strictEqual(delay, 1000);
  });

  it('caps at 30000 for many failed attempts', () => {
    createUser({
      username: 'manyfaile',
      password_hash: 'hash',
      role: 'user',
      enabled: true,
      password_reset_required: false,
      failed_attempts: 0,
      last_failed_attempt: null,
    });
    
    // Simulate 10 failed logins
    for (let i = 0; i < 10; i++) {
      // Need to find user id first
      const db = require('@/lib/db').getDb();
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get('manyfaile');
      require('@/lib/db').recordFailedLogin(user.id);
    }
    
    const delay = getLoginDelay('manyfaile');
    assert.strictEqual(delay, 30000);
  });
});