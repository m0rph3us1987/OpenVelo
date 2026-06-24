import Database from 'better-sqlite3';
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { resetTestDb, getProjectsForUser, isUserAuthorizedForProject } from '@/lib/db';

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
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
      poll_interval INTEGER NOT NULL DEFAULT 60000,
      agent_max_timeout INTEGER NOT NULL DEFAULT 300,
      max_parallel_jobs INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      agent_max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
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
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS group_projects (
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, project_id)
    );
  `);
}

describe('db auth helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    resetTestDb(db);
  });

  after(() => {
    db.close();
  });

  it('getProjectsForUser returns all projects for admin', () => {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});

    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-c', 3003)`).run({});

    const projects = getProjectsForUser(1, 'admin');
    assert.strictEqual(projects.length, 3);
  });

  it('getProjectsForUser returns only linked projects for regular user', () => {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});

    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-c', 3003)`).run({});

    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 2)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 2)`).run({});

    const projects = getProjectsForUser(2, 'user');
    assert.strictEqual(projects.length, 2);
    assert.ok(projects.some(p => p.name === 'proj-a'));
    assert.ok(projects.some(p => p.name === 'proj-b'));
    assert.ok(!projects.some(p => p.name === 'proj-c'));
  });

  it('isUserAuthorizedForProject returns true for admin', () => {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash', 'admin')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});

    const result = isUserAuthorizedForProject(1, 1);
    assert.strictEqual(result, true);
  });

  it('isUserAuthorizedForProject returns true for group member', () => {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 1)`).run({});

    const result = isUserAuthorizedForProject(1, 1);
    assert.strictEqual(result, true);
  });

  it('isUserAuthorizedForProject returns false when user has no group in common with project', () => {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('user', 'hash', 'user')`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-a', 3001)`).run({});
    db.prepare(`INSERT INTO projects (name, port) VALUES ('proj-b', 3002)`).run({});
    db.prepare(`INSERT INTO groups (name) VALUES ('team-alpha')`).run({});
    db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (1, 1)`).run({});
    db.prepare(`INSERT INTO group_projects (group_id, project_id) VALUES (1, 2)`).run({});

    const result = isUserAuthorizedForProject(1, 1);
    assert.strictEqual(result, false);
  });
});