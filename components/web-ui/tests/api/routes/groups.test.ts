import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb, resetTestDb, closeDb, createUser, createProject, createGroup, getGroupById } from '@/lib/db';
import { groupsRouter } from '@/api/routes/groups';
import { authRouter } from '@/api/routes/auth';
import supertest from 'supertest';

describe('groups routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = new Database(':memory:');
    resetTestDb(db);
    initDb();
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/groups', groupsRouter);
  });

  after(() => {
    closeDb();
  });

  async function getAdminCookie(agent: supertest.SuperagentTest): Promise<string> {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Admin123!', 10);
    createUser({ username: 'admin', password_hash: hash, role: 'admin', enabled: true, password_reset_required: false });
    const loginRes = await agent.post('/api/auth/login').send({ username: 'admin', password: 'Admin123!' });
    const cookieHeader = loginRes.headers['set-cookie'];
    const cookieValue = Array.isArray(cookieHeader)
      ? cookieHeader.find(c => c.startsWith('openvelo-token='))?.split(';')[0]
      : String(cookieHeader).split(';')[0];
    return cookieValue ?? '';
  }

  describe('POST /api/groups', () => {
    it('creates group with members and projects', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const u2 = createUser({ username: 'user2', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const p2 = createProject({ name: 'proj2', port: 7002, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });

      const res = await agent.post('/api/groups').set('Cookie', cookie).send({
        name: 'Test Group',
        description: 'A test group',
        userIds: [u1.id, u2.id],
        projectIds: [p1.id, p2.id],
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.name, 'Test Group');
      assert.strictEqual(res.body.description, 'A test group');
      assert.strictEqual(res.body.members.length, 2);
      assert.strictEqual(res.body.projects.length, 2);
    });

    it('rejects duplicate group name', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      createGroup({ name: 'Existing Group' });

      const res = await agent.post('/api/groups').set('Cookie', cookie).send({ name: 'Existing Group' });
      assert.strictEqual(res.status, 409);
      assert.ok(res.body.error.includes('already exists'));
    });

    it('rejects missing name', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);

      const res = await agent.post('/api/groups').set('Cookie', cookie).send({ description: 'No name' });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/groups', () => {
    it('returns all groups with members and projects', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const g1 = createGroup({ name: 'Group A' });

      const db = (await import('@/lib/db')).getDb();
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g1.id, u1.id);
      db.prepare('INSERT INTO group_projects (group_id, project_id) VALUES (?, ?)').run(g1.id, p1.id);

      const res = await agent.get('/api/groups').set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const found = res.body.find((g: { name: string }) => g.name === 'Group A');
      assert.ok(found);
      assert.strictEqual(found.members.length, 1);
      assert.strictEqual(found.projects.length, 1);
    });
  });

  describe('GET /api/groups/:id', () => {
    it('returns group with members and projects', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const g1 = createGroup({ name: 'Single Group' });
      const db = (await import('@/lib/db')).getDb();
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g1.id, u1.id);

      const res = await agent.get(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Single Group');
      assert.strictEqual(res.body.members.length, 1);
    });

    it('returns 404 for non-existent group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);

      const res = await agent.get('/api/groups/9999').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('PUT /api/groups/:id', () => {
    it('updates group and syncs members', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const u2 = createUser({ username: 'user2', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const g1 = createGroup({ name: 'Original' });

      const res = await agent.put(`/api/groups/${g1.id}`).set('Cookie', cookie).send({ name: 'Updated', userIds: [u1.id, u2.id] });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Updated');
      assert.strictEqual(res.body.members.length, 2);
    });

    it('updates group and syncs projects', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const p2 = createProject({ name: 'proj2', port: 7002, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const g1 = createGroup({ name: 'Original' });

      const res = await agent.put(`/api/groups/${g1.id}`).set('Cookie', cookie).send({ projectIds: [p1.id, p2.id] });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.projects.length, 2);
    });

    it('returns 404 for non-existent group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);

      const res = await agent.put('/api/groups/9999').set('Cookie', cookie).send({ name: 'New Name' });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/groups/:id', () => {
    it('deletes group and its junctions', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const g1 = createGroup({ name: 'ToDelete' });
      const db = (await import('@/lib/db')).getDb();
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g1.id, u1.id);
      db.prepare('INSERT INTO group_projects (group_id, project_id) VALUES (?, ?)').run(g1.id, p1.id);

      const res = await agent.delete(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);

      const after = getGroupById(g1.id);
      assert.strictEqual(after, undefined);
    });

    it('returns 404 for non-existent group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);

      const res = await agent.delete('/api/groups/9999').set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/groups/:id/members/:userId', () => {
    it('adds a single member to group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const g1 = createGroup({ name: 'Member Test' });

      const res = await agent.post(`/api/groups/${g1.id}/members/${u1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);

      const groupRes = await agent.get(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(groupRes.body.members.length, 1);
    });

    it('returns 404 for non-existent group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });

      const res = await agent.post(`/api/groups/9999/members/${u1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/groups/:id/members/:userId', () => {
    it('removes a single member from group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const bcrypt = await import('bcryptjs');
      const u1 = createUser({ username: 'user1', password_hash: await bcrypt.hash('Pass123!', 10), role: 'user', enabled: true, password_reset_required: false });
      const g1 = createGroup({ name: 'Remove Member Test' });
      const db = (await import('@/lib/db')).getDb();
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g1.id, u1.id);

      const res = await agent.delete(`/api/groups/${g1.id}/members/${u1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);

      const groupRes = await agent.get(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(groupRes.body.members.length, 0);
    });
  });

  describe('POST /api/groups/:id/projects/:projectId', () => {
    it('assigns a single project to group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const g1 = createGroup({ name: 'Project Assign Test' });

      const res = await agent.post(`/api/groups/${g1.id}/projects/${p1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);

      const groupRes = await agent.get(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(groupRes.body.projects.length, 1);
    });
  });

  describe('DELETE /api/groups/:id/projects/:projectId', () => {
    it('removes a single project from group', async () => {
      const agent = supertest(app);
      const cookie = await getAdminCookie(agent);
      const p1 = createProject({ name: 'proj1', port: 7001, password_hash: null, repo_host: 'github', repo_url: '', repo_pat: null, docker_image: 'openvelo-agent:linux', backend: 'opencode', default_model: '', execution_model: '', analyzer_model: '', chat_model: '', requirement_model: '', planning_model: '', build_cmd: null, test_cmd: null, staging_branch: 'staging', poll_interval: 60000, agent_max_timeout: 1800000, max_parallel_jobs: 1, max_retries: 3, agent_max_retries: 3, status: 'stopped', pid: null });
      const g1 = createGroup({ name: 'Project Remove Test' });
      const db = (await import('@/lib/db')).getDb();
      db.prepare('INSERT INTO group_projects (group_id, project_id) VALUES (?, ?)').run(g1.id, p1.id);

      const res = await agent.delete(`/api/groups/${g1.id}/projects/${p1.id}`).set('Cookie', cookie);
      assert.strictEqual(res.status, 200);

      const groupRes = await agent.get(`/api/groups/${g1.id}`).set('Cookie', cookie);
      assert.strictEqual(groupRes.body.projects.length, 0);
    });
  });
});