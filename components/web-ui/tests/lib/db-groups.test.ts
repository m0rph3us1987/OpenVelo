import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, beforeEach, after } from 'node:test';
import { initDb, resetTestDb, closeDb, createGroup, getGroupById, getAllGroups, updateGroup, deleteGroup, addGroupMember, removeGroupMember, addGroupProject, removeGroupProject, getGroupMembers, getGroupProjects, getUserGroups, getProjectGroups, createUser, createProject } from '@/lib/db';

describe('group CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
  });

  after(() => {
    closeDb();
  });

  it('creates a group', () => {
    const g = createGroup({ name: 'Test Group', description: 'A test group' });
    assert.strictEqual(g.id, 1);
    assert.strictEqual(g.name, 'Test Group');
    assert.strictEqual(g.description, 'A test group');
  });

  it('gets a group by id', () => {
    const created = createGroup({ name: 'Fetch Group' });
    const fetched = getGroupById(created.id);
    assert.strictEqual(fetched!.name, 'Fetch Group');
  });

  it('gets all groups', () => {
    createGroup({ name: 'Group A' });
    createGroup({ name: 'Group B' });
    const groups = getAllGroups();
    assert.ok(groups.length >= 2);
  });

  it('updates a group', () => {
    const g = createGroup({ name: 'Original' });
    const updated = updateGroup(g.id, { name: 'Updated', description: 'New desc' });
    assert.strictEqual(updated!.name, 'Updated');
    assert.strictEqual(updated!.description, 'New desc');
  });

  it('deletes a group', () => {
    const g = createGroup({ name: 'ToDelete' });
    deleteGroup(g.id);
    assert.strictEqual(getGroupById(g.id), undefined);
  });

  it('adds and removes group members', () => {
    const g = createGroup({ name: 'Members Group' });
    const u = createUser({ username: 'alice', password_hash: 'hash', role: 'admin', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    addGroupMember(g.id, u.id);
    const members = getGroupMembers(g.id);
    assert.strictEqual(members.length, 1);
    assert.strictEqual(members[0].username, 'alice');
    removeGroupMember(g.id, u.id);
    assert.strictEqual(getGroupMembers(g.id).length, 0);
  });

  it('adds and removes group projects', () => {
    const g = createGroup({ name: 'Projects Group' });
    const p = createProject({
      remove_deleted_containers: 1,
      name: 'TestProject',
      password_hash: null,
      port: 9000,
      repo_host: 'github',
      repo_url: '',
      repo_pat: null,
      docker_image: 'openvelo-agent:linux',
      backend: 'opencode',
      default_model: '',
      execution_model: '',
      blueprint_model: '',
      analyzer_model: '',
      chat_model: '',
      requirement_model: '',
      planning_model: '',
      review_model: '',
      documentation_model: '',
      build_cmd: null,
      test_cmd: null,
      staging_branch: 'staging',
      poll_interval: 60000,
      agent_max_timeout: 300,
      max_parallel_jobs: 1,
      max_retries: 3,
      agent_max_retries: 3,
      status: 'stopped',
      pid: null,
    });
    addGroupProject(g.id, p.id);
    const projects = getGroupProjects(g.id);
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].name, 'TestProject');
    removeGroupProject(g.id, p.id);
    assert.strictEqual(getGroupProjects(g.id).length, 0);
  });

  it('deleting a group cascades junction rows but leaves users and projects intact', () => {
    const g = createGroup({ name: 'Cascade Group' });
    const u = createUser({ username: 'bob', password_hash: 'hash', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    const p = createProject({
      remove_deleted_containers: 1,
      name: 'CascadeProject',
      password_hash: null,
      port: 9001,
      repo_host: 'github',
      repo_url: '',
      repo_pat: null,
      docker_image: 'openvelo-agent:linux',
      backend: 'opencode',
      default_model: '',
      execution_model: '',
      blueprint_model: '',
      analyzer_model: '',
      chat_model: '',
      requirement_model: '',
      planning_model: '',
      review_model: '',
      documentation_model: '',
      build_cmd: null,
      test_cmd: null,
      staging_branch: 'staging',
      poll_interval: 60000,
      agent_max_timeout: 300,
      max_parallel_jobs: 1,
      max_retries: 3,
      agent_max_retries: 3,
      status: 'stopped',
      pid: null,
    });
    addGroupMember(g.id, u.id);
    addGroupProject(g.id, p.id);

    deleteGroup(g.id);

    assert.strictEqual(getGroupById(g.id), undefined);
    assert.strictEqual(getUserGroups(u.id).length, 0);
    assert.strictEqual(getProjectGroups(p.id).length, 0);
  });

  it('getUserGroups returns correct associations', () => {
    const g = createGroup({ name: 'User Groups Test' });
    const u1 = createUser({ username: 'user1', password_hash: 'hash', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    const u2 = createUser({ username: 'user2', password_hash: 'hash', role: 'user', enabled: true, password_reset_required: false, failed_attempts: 0, last_failed_attempt: null });
    addGroupMember(g.id, u1.id);
    addGroupMember(g.id, u2.id);
    const groups = getUserGroups(u1.id);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].name, 'User Groups Test');
  });

  it('getProjectGroups returns correct associations', () => {
    const g = createGroup({ name: 'Project Groups Test' });
    const p = createProject({
      remove_deleted_containers: 1,
      name: 'ProjGroupsTest',
      password_hash: null,
      port: 9002,
      repo_host: 'github',
      repo_url: '',
      repo_pat: null,
      docker_image: 'openvelo-agent:linux',
      backend: 'opencode',
      default_model: '',
      execution_model: '',
      blueprint_model: '',
      analyzer_model: '',
      chat_model: '',
      requirement_model: '',
      planning_model: '',
      review_model: '',
      documentation_model: '',
      build_cmd: null,
      test_cmd: null,
      staging_branch: 'staging',
      poll_interval: 60000,
      agent_max_timeout: 300,
      max_parallel_jobs: 1,
      max_retries: 3,
      agent_max_retries: 3,
      status: 'stopped',
      pid: null,
    });
    addGroupProject(g.id, p.id);
    const groups = getProjectGroups(p.id);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].name, 'Project Groups Test');
  });
});