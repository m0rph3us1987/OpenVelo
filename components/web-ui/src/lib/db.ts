import Database from 'better-sqlite3';
import path from 'path';
import type { Project, Job, User, Group } from './types';

interface RawUser {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  enabled: number;
  password_reset_required: number;
  failed_attempts: number;
  last_failed_attempt: string | null;
  created_at: string;
  updated_at: string;
}

function getDbPath(): string {
  const envPath = process.env.OPENVELO_DB_PATH || process.env.OLYMP_DB_PATH;
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(process.cwd(), '..', '..', 'openvelo.sqlite');
}

export let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(getDbPath());
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function resetTestDb(testDb: Database.Database): void {
  _db = testDb;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function initDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT,
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
      remove_deleted_containers INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id),
      depends_on TEXT,
      title TEXT,
      description TEXT,
      acceptance_criteria TEXT,
      status TEXT,
      container_id TEXT,
      branch TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      started_at DATETIME,
      stage TEXT,
      agent_attempt INTEGER,
      agent_max_retries INTEGER,
      runtime INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('theme', 'dark');
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('app_title', 'OpenVelo');
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('debug_sse_console', 'false');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
    DELETE FROM ui_settings WHERE key = 'password';
    INSERT OR IGNORE INTO ui_settings (key, value) VALUES ('security_enabled', 'false');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('plan', 'quick', 'verify')),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'init',
      sub_stage TEXT NOT NULL DEFAULT '',
      sub_stage_pre_error TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'collecting',
      role TEXT NOT NULL CHECK(role IN ('user', 'system')),
      message TEXT NOT NULL,
      ready_for_next_stage INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_message_options (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL UNIQUE,
      options_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      recommended_index INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES domain_questions(id) ON DELETE CASCADE,
      selected_option INTEGER,
      custom_answer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, question_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS requirement_outline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      section_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, section_index)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS requirement_section (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      outline_id INTEGER NOT NULL REFERENCES requirement_outline(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(outline_id, chat_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_epics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      epic_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      build_cmd TEXT NOT NULL DEFAULT '',
      test_cmd TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, epic_index)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      epic_id INTEGER NOT NULL REFERENCES plan_epics(id) ON DELETE CASCADE,
      feature_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, epic_id, feature_index)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES plan_features(id) ON DELETE CASCADE,
      story_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, feature_id, story_index)
    )
  `);

  const migrations = [
    `ALTER TABLE projects DROP COLUMN opencode_api_key`,
    `ALTER TABLE projects ADD COLUMN default_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN execution_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN analyzer_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN chat_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN requirement_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN planning_model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects DROP COLUMN backend_model`,
    `ALTER TABLE jobs ADD COLUMN runtime INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN last_failed_attempt DATETIME`,
    `ALTER TABLE chat_sessions ADD COLUMN running INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE chat_sessions ADD COLUMN sub_stage_pre_error TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE chat_messages ADD COLUMN ready_for_next_stage INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE domains DROP COLUMN key_topics_json`,
    `ALTER TABLE chat_sessions ADD COLUMN error_type TEXT`,
    `ALTER TABLE projects ADD COLUMN remove_deleted_containers INTEGER NOT NULL DEFAULT 1`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* ignore */ }
  }
  try {
    db.exec(`UPDATE jobs SET depends_on = json_array(depends_on) WHERE depends_on IS NOT NULL AND depends_on NOT LIKE '[%'`);
  } catch { /* ignore */ }
}

export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function getProject(id: number): Project | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function getProjectByName(name: string): Project | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE name = ? COLLATE NOCASE').get(name) as Project | undefined;
}

export function createProject(data: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Project {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO projects (name, password_hash, port,
      repo_host, repo_url, repo_pat, docker_image, backend,
      default_model, execution_model, analyzer_model, chat_model, requirement_model, planning_model,
      build_cmd, test_cmd, staging_branch, poll_interval, agent_max_timeout, max_parallel_jobs, max_retries, agent_max_retries, remove_deleted_containers,
      status, pid)
    VALUES (@name, @password_hash, @port,
      @repo_host, @repo_url, @repo_pat, @docker_image, @backend,
      @default_model, @execution_model, @analyzer_model, @chat_model, @requirement_model, @planning_model,
      @build_cmd, @test_cmd, @staging_branch, @poll_interval, @agent_max_timeout, @max_parallel_jobs, @max_retries, @agent_max_retries, @remove_deleted_containers,
      @status, @pid)
  `).run(data);
  return getProject(result.lastInsertRowid as number)!;
}

export function updateProject(id: number, data: Partial<Omit<Project, 'id' | 'created_at'>>): Project | undefined {
  const db = getDb();
  const fields = Object.keys(data)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  if (!fields) return getProject(id);
  db.prepare(`UPDATE projects SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
    ...data,
    id,
  });
  return getProject(id);
}

export function deleteProject(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM jobs WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function getJobsByProject(projectId: number): Job[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM jobs WHERE project_id = ?
      ORDER BY
        CASE status
          WHEN 'RUNNING'   THEN 0
          WHEN 'PENDING'   THEN 1
          WHEN 'FAILED'    THEN 2
          WHEN 'COMPLETED' THEN 3
          ELSE 4
        END ASC,
        CASE WHEN status = 'COMPLETED' THEN created_at END ASC,
        created_at DESC
    `)
    .all(projectId) as Job[];
}

export function getJob(jobId: number): Job | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Job | undefined;
}

export function updateJob(jobId: number, data: Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>>): Job | undefined {
  const db = getDb();
  const fields = Object.keys(data)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  if (!fields) return getJob(jobId);
  db.prepare(`UPDATE jobs SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
    ...data,
    id: jobId,
  });
  return getJob(jobId);
}

export function resetJob(jobId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'PENDING', container_id = NULL, retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(jobId);
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';

export function setJobStatus(jobId: number, status: JobStatus): void {
  const db = getDb();
  if (status === 'PENDING') {
    db.prepare('UPDATE jobs SET status = ?, started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, jobId);
  } else {
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, jobId);
  }
}

export function setJobStarted(jobId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(jobId);
}

export function deleteJobByAdoId(projectId: number, adoId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM jobs WHERE project_id = ? AND ado_id = ?').run(projectId, adoId);
}

export function deleteJobs(projectId: number, jobIds: number[]): void {
  const db = getDb();
  const CHUNK_SIZE = 900;
  for (let i = 0; i < jobIds.length; i += CHUNK_SIZE) {
    const chunk = jobIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    db.prepare(`DELETE FROM jobs WHERE project_id = ? AND id IN (${placeholders})`).run(projectId, ...chunk);
  }
}

export function deleteJobsByProject(projectId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM jobs WHERE project_id = ?').run(projectId);
}

export function markProjectPaused(id: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE projects SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(id);
}

export function markProjectStopped(id: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE projects SET status = 'stopped', pid = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(id);
}

export function markProjectRunning(id: number, pid: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE projects SET status = 'running', pid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(pid, id);
}

export function getNextAvailablePort(): number {
  const db = getDb();
  const row = db.prepare('SELECT MAX(port) as max_port FROM projects').get() as { max_port: number | null };
  return (row.max_port ?? 3000) + 1;
}

export function isPortInUse(port: number, excludeId?: number): boolean {
  const db = getDb();
  if (excludeId) {
    const row = db.prepare('SELECT id FROM projects WHERE port = ? AND id != ?').get(port, excludeId);
    return !!row;
  }
  const row = db.prepare('SELECT id FROM projects WHERE port = ?').get(port);
  return !!row;
}

export function insertLocalJob(projectId: number, input: {
  title: string;
  description?: string | unknown | null;
  acceptanceCriteria?: string | unknown | null;
  dependsOn?: string[] | null;
}): Job {
  const db = getDb();

  const title = typeof input.title === 'string' ? input.title : JSON.stringify(input.title);
  const description = Array.isArray(input.description) ? input.description.join('\n')
    : (typeof input.description === 'object' && input.description !== null ? JSON.stringify(input.description) : input.description ?? null);
  const acceptanceCriteria = Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.join('\n')
    : (typeof input.acceptanceCriteria === 'object' && input.acceptanceCriteria !== null ? JSON.stringify(input.acceptanceCriteria) : input.acceptanceCriteria ?? null);

  const predecessorJson = input.dependsOn && input.dependsOn.length > 0
    ? JSON.stringify(input.dependsOn)
    : null;

  const result = db.prepare(`
    INSERT INTO jobs (project_id, title, description, acceptance_criteria, depends_on, status)
    VALUES (@projectId, @title, @description, @acceptanceCriteria, @predecessorJson, 'PENDING')
  `).run({
    projectId,
    title,
    description,
    acceptanceCriteria,
    predecessorJson
  });

  const rowId = result.lastInsertRowid as number;
  return getJob(rowId)!;
}

export function getRunningJobsByProject(projectId: number): Job[] {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE project_id = ? AND status = 'RUNNING'").all(projectId) as Job[];
}

export function resetAllRunningJobs(): number {
  const db = getDb();
  const result = db.prepare(
    "UPDATE jobs SET status = 'PENDING', container_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE status = 'RUNNING'"
  ).run();
  return result.changes;
}

export function resetAllRunningChatSessions(): number {
  const db = getDb();
  const result = db.prepare(
    "UPDATE chat_sessions SET running = 0, updated_at = CURRENT_TIMESTAMP WHERE running = 1"
  ).run();
  return result.changes;
}

export function getPendingJobsByProject(projectId: number): Job[] {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE project_id = ? AND status = 'PENDING' ORDER BY id ASC").all(projectId) as Job[];
}

export function updateJobRunning(jobId: number, containerId: string, startedAt?: string): void {
  const db = getDb();
  if (startedAt) {
    db.prepare(
      "UPDATE jobs SET status = 'RUNNING', container_id = ?, started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(containerId, startedAt, jobId);
  } else {
    db.prepare(
      "UPDATE jobs SET status = 'RUNNING', container_id = ?, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(containerId, jobId);
  }
}

export function updateJobCompleted(jobId: number, branch?: string | null, runtime?: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'COMPLETED', branch = ?, runtime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(branch ?? null, runtime ?? 0, jobId);
}

export function updateJobFailed(jobId: number, runtime?: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'FAILED', runtime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runtime ?? 0, jobId);
}

export function updateJobStopped(jobId: number, runtime?: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'STOPPED', runtime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runtime ?? 0, jobId);
}

export function updateJobStage(jobId: number, stage: string, agentAttempt?: number | null, agentMaxRetries?: number | null): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET stage = ?, agent_attempt = ?, agent_max_retries = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(stage, agentAttempt ?? null, agentMaxRetries ?? null, jobId);
}

export function updateJobContainerId(jobId: number, containerId: string | null): void {
  const db = getDb();
  db.prepare("UPDATE jobs SET container_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(containerId, jobId);
}

export function incrementJobRetry(jobId: number): number {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET retry_count = retry_count + 1, status = 'PENDING', container_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(jobId);
  const row = db.prepare("SELECT retry_count FROM jobs WHERE id = ?").get(jobId) as { retry_count: number } | undefined;
  return row?.retry_count ?? 0;
}

export function updateJobPending(jobId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'PENDING', container_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(jobId);
}

export function setJobsRunning(jobIds: number[]): void {
  if (jobIds.length === 0) return;
  const db = getDb();
  const placeholders = jobIds.map(() => '?').join(',');
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
  ).run(...jobIds);
}

export function getNextRunnableJobs(projectId: number, count: number): Job[] {
  const db = getDb();
  const pendingJobs = db.prepare(
    "SELECT * FROM jobs WHERE project_id = ? AND status = 'PENDING' ORDER BY id ASC"
  ).all(projectId) as Job[];

  const allJobs = db.prepare(
    "SELECT * FROM jobs WHERE project_id = ?"
  ).all(projectId) as Job[];

  const jobMap = new Map<string, Job>();
  for (const job of allJobs) {
    jobMap.set(String(job.id), job);
  }

  const runnable: Job[] = [];
  for (const job of pendingJobs) {
    if (runnable.length >= count) break;

    if (!job.depends_on) {
      runnable.push(job);
      continue;
    }

    let predecessorIds: string[];
    try {
      predecessorIds = JSON.parse(job.depends_on);
    } catch {
      predecessorIds = [job.depends_on];
    }

    let blocked = false;
    for (const predId of predecessorIds) {
      const predJob = jobMap.get(String(predId));
      if (!predJob || predJob.status !== 'COMPLETED') {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      runnable.push(job);
    }
  }

  return runnable;
}

export function getUiSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM ui_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setUiSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO ui_settings (key, value) VALUES (?, ?)').run(key, value);
}

// --- Models ---

export interface Model {
  id: number;
  provider: string;
  model_name: string;
  created_at: string;
  updated_at: string;
}

export function getAllModels(): Model[] {
  const db = getDb();
  return db.prepare('SELECT * FROM models ORDER BY provider ASC, model_name ASC').all() as Model[];
}

export function getModel(id: number): Model | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM models WHERE id = ?').get(id) as Model | undefined;
}

export function upsertModel(provider: string, modelName: string): Model {
  const trimmedProvider = provider.trim();
  const trimmedModelName = modelName.trim();
  if (!trimmedProvider || !trimmedModelName) {
    throw new Error(`Invalid model data: provider="${trimmedProvider}", modelName="${trimmedModelName}"`);
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE provider = ? AND model_name = ?').get(trimmedProvider, trimmedModelName) as Model | undefined;
  if (existing) {
    return existing;
  }
  const result = db.prepare(`
    INSERT INTO models (provider, model_name)
    VALUES (@provider, @model_name)
  `).run({ provider: trimmedProvider, model_name: trimmedModelName });
  return getModel(result.lastInsertRowid as number)!;
}

export function deleteModel(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM models WHERE id = ?').run(id);
}

export function refreshModels(output: string): Model[] {
  const lines = output.trim().split('\n').filter(line => line.includes('/'));
  const parsed = lines.map(line => {
    const idx = line.lastIndexOf('/');
    return { provider: line.substring(0, idx), modelName: line.substring(idx + 1) };
  });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM models').all() as Model[];
  const newKeys = new Set(parsed.map(p => `${p.provider}::${p.modelName}`));

  for (const model of existing) {
    const key = `${model.provider}::${model.model_name}`;
    if (!newKeys.has(key)) {
      db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
    }
  }

  for (const { provider, modelName } of parsed) {
    if (!provider || !modelName) continue;
    upsertModel(provider, modelName);
  }

  return getAllModels();
}

export interface ProjectModels {
  default_model: string;
  execution_model: string;
  analyzer_model: string;
  chat_model: string;
  requirement_model: string;
  planning_model: string;
}

export function getProjectModels(projectId: number): ProjectModels {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');

  const defaultModel = project.default_model;
  if (!defaultModel) {
    throw new Error('Project default_model is not set');
  }
  return {
    default_model: defaultModel,
    execution_model: project.execution_model || defaultModel,
    analyzer_model: project.analyzer_model || defaultModel,
    chat_model: project.chat_model || defaultModel,
    requirement_model: project.requirement_model || defaultModel,
    planning_model: project.planning_model || defaultModel,
  };
}

function mapRawUser(row: RawUser): User {
  return {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    role: row.role,
    enabled: row.enabled === 1,
    password_reset_required: row.password_reset_required === 1,
    failed_attempts: row.failed_attempts,
    last_failed_attempt: row.last_failed_attempt,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function recordFailedLogin(userId: number): void {
  const db = getDb();
  db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

export function resetFailedLogin(userId: number): void {
  const db = getDb();
  db.prepare('UPDATE users SET failed_attempts = 0, last_failed_attempt = NULL WHERE id = ?').run(userId);
}

export function createUser(data: Omit<User, 'id' | 'created_at' | 'updated_at'>): User {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, enabled, password_reset_required)
    VALUES (@username, @password_hash, @role, @enabled, @password_reset_required)
  `).run({
    username: data.username,
    password_hash: data.password_hash,
    role: data.role,
    enabled: data.enabled ? 1 : 0,
    password_reset_required: data.password_reset_required ? 1 : 0,
  });
  return getUserById(result.lastInsertRowid as number)!;
}

export function getUserById(id: number): User | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUser | undefined;
  return row ? mapRawUser(row) : undefined;
}

export function getUserByUsername(username: string): User | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as RawUser | undefined;
  return row ? mapRawUser(row) : undefined;
}

export function getAllUsers(): User[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as RawUser[];
  return rows.map(mapRawUser);
}

export function updateUser(id: number, data: Partial<Omit<User, 'id' | 'created_at'>>): User | undefined {
  const db = getDb();
  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) updateData.username = data.username;
  if (data.password_hash !== undefined) updateData.password_hash = data.password_hash;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.enabled !== undefined) updateData.enabled = data.enabled ? 1 : 0;
  if (data.password_reset_required !== undefined) updateData.password_reset_required = data.password_reset_required ? 1 : 0;
  const fields = Object.keys(updateData)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  if (!fields) return getUserById(id);
  db.prepare(`UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
    ...updateData,
    id,
  });
  return getUserById(id);
}

export function countEnabledAdmins(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND enabled = 1").get() as { count: number };
  return row.count;
}

export function setPasswordResetRequired(id: number, required: boolean): void {
  const db = getDb();
  db.prepare('UPDATE users SET password_reset_required = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(required ? 1 : 0, id);
}

export function createGroup(data: { name: string; description?: string }): Group {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO groups (name, description)
    VALUES (@name, @description)
  `).run({
    name: data.name,
    description: data.description ?? null,
  });
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid as number) as Group;
}

export function getGroupById(id: number): Group | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group | undefined;
}

export function getAllGroups(): Group[] {
  const db = getDb();
  return db.prepare('SELECT * FROM groups ORDER BY id ASC').all() as Group[];
}

export function updateGroup(id: number, data: { name?: string; description?: string }): Group | undefined {
  const db = getDb();
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  const fields = Object.keys(updateData)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  if (!fields) return getGroupById(id);
  db.prepare(`UPDATE groups SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
    ...updateData,
    id,
  });
  return getGroupById(id);
}

export function deleteGroup(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

export function addGroupMember(groupId: number, userId: number): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, userId);
}

export function removeGroupMember(groupId: number, userId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
}

export function addGroupProject(groupId: number, projectId: number): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO group_projects (group_id, project_id) VALUES (?, ?)').run(groupId, projectId);
}

export function removeGroupProject(groupId: number, projectId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM group_projects WHERE group_id = ? AND project_id = ?').run(groupId, projectId);
}

export function getGroupMembers(groupId: number): User[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.* FROM users u
    JOIN group_members gm ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY u.id ASC
  `).all(groupId) as RawUser[];
  return rows.map(mapRawUser);
}

export function getGroupProjects(groupId: number): Project[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM projects p
    JOIN group_projects gp ON p.id = gp.project_id
    WHERE gp.group_id = ?
    ORDER BY p.id ASC
  `).all(groupId) as Project[];
}

export function getUserGroups(userId: number): Group[] {
  const db = getDb();
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON g.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY g.id ASC
  `).all(userId) as Group[];
}

export function getProjectGroups(projectId: number): Group[] {
  const db = getDb();
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_projects gp ON g.id = gp.group_id
    WHERE gp.project_id = ?
    ORDER BY g.id ASC
  `).all(projectId) as Group[];
}

export function getProjectsForUser(userId: number, role: string): Project[] {
  if (role === 'admin') {
    return getAllProjects();
  }
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT p.* FROM projects p
    JOIN group_projects gp ON p.id = gp.project_id
    JOIN group_members gm ON gp.group_id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as Project[];
}

export function isUserAuthorizedForProject(userId: number, projectId: number): boolean {
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (user?.role === 'admin') {
    return true;
  }
  const row = db.prepare(`
    SELECT 1 FROM groups g
    JOIN group_members gm ON g.id = gm.group_id
    JOIN group_projects gp ON g.id = gp.group_id
    WHERE gm.user_id = ? AND gp.project_id = ?
    LIMIT 1
  `).get(userId, projectId);
  return !!row;
}

// --- Chat Messages ---

export interface ChatMessageRow {
  id: number;
  project_id: number;
  chat_id: number;
  stage: string;
  role: 'user' | 'system';
  message: string;
  ready_for_next_stage: boolean;
  created_at: string;
}

export function insertChatMessage(data: {
  project_id: number;
  chat_id: number;
  stage: string;
  role: 'user' | 'system';
  message: string;
  ready_for_next_stage?: boolean;
}): ChatMessageRow {
  const db = getDb();
  const bindData = {
    project_id: data.project_id,
    chat_id: data.chat_id,
    stage: data.stage,
    role: data.role,
    message: data.message,
    ready_for_next_stage: data.ready_for_next_stage ? 1 : 0,
  };
  const result = db.prepare(`
    INSERT INTO chat_messages (project_id, chat_id, stage, role, message, ready_for_next_stage)
    VALUES (@project_id, @chat_id, @stage, @role, @message, @ready_for_next_stage)
  `).run(bindData);
  return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid as number) as ChatMessageRow;
}

export function getChatMessages(chatId: number): ChatMessageRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId) as ChatMessageRow[];
}

export function deleteChatMessage(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
}

// --- Chat Message Options ---

export interface ChatMessageOptionsRow {
  id: number;
  message_id: number;
  options_json: string;
  created_at: string;
}

export function insertMessageOptions(data: { id: number; options_json: string }): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO chat_message_options (id, message_id, options_json)
    VALUES (@id, @id, @options_json)
  `).run(data);
}

export function getMessageOptions(messageId: number): Array<{recommended: boolean, option: string}> {
  const db = getDb();
  const row = db.prepare('SELECT options_json FROM chat_message_options WHERE message_id = ?').get(messageId) as { options_json: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.options_json) as Array<{recommended: boolean, option: string}>;
  } catch {
    return [];
  }
}

export function deleteMessageOptions(messageId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM chat_message_options WHERE message_id = ?').run(messageId);
}

// --- Chat Sessions ---

export interface ChatSessionRow {
  id: number;
  mode: string;
  project_id: number;
  name: string;
  stage: string;
  sub_stage: string;
  sub_stage_pre_error: string;
  running: boolean;
  error_type?: string | null;
  created_at: string;
  updated_at: string;
}

export function createChatSession(data: {
  mode: string;
  project_id: number;
  name: string;
}): ChatSessionRow {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO chat_sessions (mode, project_id, name, stage, sub_stage, sub_stage_pre_error, running)
    VALUES (@mode, @project_id, @name, 'init', '', '', 0)
  `).run(data);
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid as number) as ChatSessionRow;
}

export function getChatSession(id: number): ChatSessionRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSessionRow | undefined;
}

export function getChatSessionsByProject(projectId: number): ChatSessionRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as ChatSessionRow[];
}

export function updateChatSession(id: number, data: Partial<{ stage: string; sub_stage: string; sub_stage_pre_error: string; running: boolean; error_type: string }>): ChatSessionRow | undefined {
  const db = getDb();
  const fields = Object.keys(data)
    .filter(k => k !== 'id')
    .map((k) => `${k} = @${k}`)
    .join(', ');
  if (!fields) return getChatSession(id);

  const bindData: Record<string, unknown> = { id };
  if (data.running !== undefined) bindData.running = data.running ? 1 : 0;
  if (data.stage !== undefined) bindData.stage = data.stage;
  if (data.sub_stage !== undefined) bindData.sub_stage = data.sub_stage;
  if (data.sub_stage_pre_error !== undefined) bindData.sub_stage_pre_error = data.sub_stage_pre_error;
  if (data.error_type !== undefined) bindData.error_type = data.error_type;

  db.prepare(`UPDATE chat_sessions SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run(bindData);
  return getChatSession(id);
}

export function deleteChatSession(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

export function getChatDir(chatId: number, projectId: number): string {
  const tempDataPath = process.env.OPENVELO_TEMP_DATA_PATH || process.env.OLYMP_TEMP_DATA || path.join(process.cwd(), 'temp_data');
  return path.join(tempDataPath, 'chats', `${projectId}-${chatId}`);
}

export function deleteDomainsByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM domain_questions WHERE domain_id IN (SELECT id FROM domains WHERE chat_id = ?)').run(chatId);
  db.prepare('DELETE FROM domains WHERE chat_id = ?').run(chatId);
}

// --- Requirement Outline ---

export interface RequirementOutlineRow {
  id: number;
  chat_id: number;
  section_index: number;
  title: string;
  scope: string;
  created_at: string;
}

export function insertRequirementOutline(data: {
  chat_id: number;
  section_index: number;
  title: string;
  scope: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO requirement_outline (chat_id, section_index, title, scope)
    VALUES (@chat_id, @section_index, @title, @scope)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function getRequirementOutlines(chatId: number): RequirementOutlineRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM requirement_outline WHERE chat_id = ? ORDER BY section_index ASC').all(chatId) as RequirementOutlineRow[];
}

export function getRequirementOutlineWithoutSection(chatId: number): RequirementOutlineRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT ro.* FROM requirement_outline ro
    LEFT JOIN requirement_section rs ON rs.outline_id = ro.id AND rs.chat_id = ro.chat_id
    WHERE ro.chat_id = ? AND rs.id IS NULL
    ORDER BY ro.section_index ASC
    LIMIT 1
  `).get(chatId) as RequirementOutlineRow | undefined;
}

export function deleteRequirementOutlinesByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM requirement_outline WHERE chat_id = ?').run(chatId);
}

// --- Requirement Section ---

export interface RequirementSectionRow {
  id: number;
  chat_id: number;
  outline_id: number;
  content: string;
  created_at: string;
}

export function insertRequirementSection(data: {
  chat_id: number;
  outline_id: number;
  content: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO requirement_section (chat_id, outline_id, content)
    VALUES (@chat_id, @outline_id, @content)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function getRequirementSections(chatId: number): RequirementSectionRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT rs.* FROM requirement_section rs
    JOIN requirement_outline ro ON ro.id = rs.outline_id
    WHERE rs.chat_id = ?
    ORDER BY ro.section_index ASC
  `).all(chatId) as RequirementSectionRow[];
}

export function deleteRequirementSectionsByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM requirement_section WHERE chat_id = ?').run(chatId);
}

// --- Plan Epics ---

export interface PlanEpicRow {
  id: number;
  chat_id: number;
  epic_index: number;
  title: string;
  description: string;
  content: string;
  build_cmd: string;
  test_cmd: string;
  created_at: string;
}

export function insertPlanEpic(data: {
  chat_id: number;
  epic_index: number;
  title: string;
  description: string;
  content: string;
  build_cmd: string;
  test_cmd: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO plan_epics (chat_id, epic_index, title, description, content, build_cmd, test_cmd)
    VALUES (@chat_id, @epic_index, @title, @description, @content, @build_cmd, @test_cmd)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function getPlanEpics(chatId: number): PlanEpicRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plan_epics WHERE chat_id = ? ORDER BY epic_index ASC').all(chatId) as PlanEpicRow[];
}

export function getPlanEpicWithoutFeatures(chatId: number): PlanEpicRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT pe.* FROM plan_epics pe
    LEFT JOIN plan_features pf ON pf.epic_id = pe.id
    WHERE pe.chat_id = ? AND pf.id IS NULL
    ORDER BY pe.epic_index ASC
    LIMIT 1
  `).get(chatId) as PlanEpicRow | undefined;
}

export function getPlanFeaturesForEpic(epicId: number): PlanEpicRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plan_features WHERE epic_id = ? ORDER BY feature_index ASC').all(epicId) as PlanEpicRow[];
}

export function getNextFeatureForEpic(chatId: number, epicId: number): PlanFeatureRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT pf.* FROM plan_features pf
    LEFT JOIN plan_stories ps ON ps.feature_id = pf.id
    WHERE pf.chat_id = ? AND pf.epic_id = ? AND ps.id IS NULL
    ORDER BY pf.feature_index ASC
    LIMIT 1
  `).get(chatId, epicId) as PlanFeatureRow | undefined;
}

export function deletePlanEpicsByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM plan_epics WHERE chat_id = ?').run(chatId);
}

// --- Plan Features ---

export interface PlanFeatureRow {
  id: number;
  chat_id: number;
  epic_id: number;
  feature_index: number;
  title: string;
  description: string;
  content: string;
  created_at: string;
}

export function insertPlanFeature(data: {
  chat_id: number;
  epic_id: number;
  feature_index: number;
  title: string;
  description: string;
  content: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO plan_features (chat_id, epic_id, feature_index, title, description, content)
    VALUES (@chat_id, @epic_id, @feature_index, @title, @description, @content)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function getPlanFeatures(chatId: number): PlanFeatureRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT pf.* FROM plan_features pf
    JOIN plan_epics pe ON pe.id = pf.epic_id
    WHERE pf.chat_id = ?
    ORDER BY pe.epic_index ASC, pf.feature_index ASC
  `).all(chatId) as PlanFeatureRow[];
}

export function getPlanFeatureWithoutStories(chatId: number): PlanFeatureRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT pf.* FROM plan_features pf
    JOIN plan_epics pe ON pe.id = pf.epic_id
    LEFT JOIN plan_stories ps ON ps.feature_id = pf.id
    WHERE pf.chat_id = ? AND ps.id IS NULL
    ORDER BY pe.epic_index ASC, pf.feature_index ASC
    LIMIT 1
  `).get(chatId) as PlanFeatureRow | undefined;
}

export function deletePlanFeaturesByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM plan_features WHERE chat_id = ?').run(chatId);
}

export function deletePlanFeature(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM plan_features WHERE id = ?').run(id);
}

// --- Plan Stories ---

export interface PlanStoryRow {
  id: number;
  chat_id: number;
  feature_id: number;
  story_index: number;
  title: string;
  description: string;
  acceptance_criteria: string;
  depends_on: string;
  created_at: string;
}

export function insertPlanStory(data: {
  chat_id: number;
  feature_id: number;
  story_index: number;
  title: string;
  description: string;
  acceptance_criteria: string;
  depends_on: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO plan_stories (chat_id, feature_id, story_index, title, description, acceptance_criteria, depends_on)
    VALUES (@chat_id, @feature_id, @story_index, @title, @description, @acceptance_criteria, @depends_on)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function getPlanStories(chatId: number): PlanStoryRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT ps.* FROM plan_stories ps
    JOIN plan_features pf ON pf.id = ps.feature_id
    JOIN plan_epics pe ON pe.id = pf.epic_id
    WHERE ps.chat_id = ?
    ORDER BY pe.epic_index ASC, pf.feature_index ASC, ps.story_index ASC
  `).all(chatId) as PlanStoryRow[];
}

export function getPlanStoriesForFeature(featureId: number): PlanStoryRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plan_stories WHERE feature_id = ? ORDER BY story_index ASC').all(featureId) as PlanStoryRow[];
}

export function updatePlanStoryDependsOn(storyId: number, dependsOnJson: string): void {
  const db = getDb();
  db.prepare('UPDATE plan_stories SET depends_on = ? WHERE id = ?').run(dependsOnJson, storyId);
}

export function getPlanStory(storyId: number): PlanStoryRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plan_stories WHERE id = ?').get(storyId) as PlanStoryRow | undefined;
}

export function updatePlanStory(
  storyId: number,
  updates: { title?: string; description?: string; acceptance_criteria?: string; depends_on?: string }
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id: storyId };

  if (updates.title !== undefined) {
    sets.push('title = @title');
    values.title = updates.title;
  }
  if (updates.description !== undefined) {
    sets.push('description = @description');
    values.description = updates.description;
  }
  if (updates.acceptance_criteria !== undefined) {
    sets.push('acceptance_criteria = @acceptance_criteria');
    values.acceptance_criteria = updates.acceptance_criteria;
  }
  if (updates.depends_on !== undefined) {
    sets.push('depends_on = @depends_on');
    values.depends_on = updates.depends_on;
  }

  if (sets.length === 0) return;

  db.prepare(`UPDATE plan_stories SET ${sets.join(', ')} WHERE id = @id`).run(values);
}

export function deletePlanStoriesByChatId(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM plan_stories WHERE chat_id = ?').run(chatId);
}

export function deletePlanDataByChatId(chatId: number): void {
  deletePlanStoriesByChatId(chatId);
  deletePlanFeaturesByChatId(chatId);
  deletePlanEpicsByChatId(chatId);
}

export function insertDomain(data: {
  chat_id: number;
  name: string;
  description: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO domains (chat_id, name, description)
    VALUES (@chat_id, @name, @description)
  `).run(data);
  return result.lastInsertRowid as number;
}

export function insertDomainQuestion(data: {
  domain_id: number;
  topic: string;
  question: string;
  options_json: string;
  recommended_index: number | null;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO domain_questions (domain_id, topic, question, options_json, recommended_index)
    VALUES (@domain_id, @topic, @question, @options_json, @recommended_index)
  `).run(data);
  return result.lastInsertRowid as number;
}

export interface DomainRow {
  id: number;
  chat_id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface DomainQuestionRow {
  id: number;
  domain_id: number;
  topic: string;
  question: string;
  options_json: string;
  recommended_index: number | null;
  created_at: string;
}

export function getDomainsByChatId(chatId: number): DomainRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM domains WHERE chat_id = ? ORDER BY id ASC').all(chatId) as DomainRow[];
}

export function getDomainQuestionsByChatId(chatId: number): DomainQuestionRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT dq.* FROM domain_questions dq
    JOIN domains d ON dq.domain_id = d.id
    WHERE d.chat_id = ?
    ORDER BY d.id ASC, dq.id ASC
  `).all(chatId) as DomainQuestionRow[];
}

export interface DomainAnswerRow {
  id: number;
  chat_id: number;
  question_id: number;
  selected_option: number | null;
  custom_answer: string | null;
  created_at: string;
  updated_at: string;
}

export function saveDomainAnswer(data: {
  chat_id: number;
  question_id: number;
  selected_option: number | null;
  custom_answer: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO domain_answers (chat_id, question_id, selected_option, custom_answer)
    VALUES (@chat_id, @question_id, @selected_option, @custom_answer)
    ON CONFLICT(chat_id, question_id) DO UPDATE SET
      selected_option = @selected_option,
      custom_answer = @custom_answer,
      updated_at = CURRENT_TIMESTAMP
  `).run(data);
}

export function getDomainAnswersByChatId(chatId: number): DomainAnswerRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM domain_answers WHERE chat_id = ?').all(chatId) as DomainAnswerRow[];
}