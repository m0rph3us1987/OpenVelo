import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULTS, toFormData } from '@/components/projects/ProjectForm';
import type { Project } from '@/lib/db';

describe('ProjectForm DEFAULTS', () => {
  it('includes blueprint_model with empty string value', () => {
    assert.strictEqual(DEFAULTS.blueprint_model, '');
  });

  it('includes review_model with empty string value', () => {
    assert.strictEqual(DEFAULTS.review_model, '');
  });

  it('includes documentation_model with empty string value', () => {
    assert.strictEqual(DEFAULTS.documentation_model, '');
  });
});

describe('ProjectForm toFormData', () => {
  const mockProject: Project = {
    id: 1,
    name: 'test-project',
    password_hash: null,
    port: 3001,
    repo_host: 'github',
    repo_url: 'https://github.com/test/repo.git',
    repo_pat: null,
    docker_image: 'openvelo-agent:linux',
    backend: 'opencode',
    default_model: 'openai/gpt-4o',
    execution_model: 'anthropic/claude-3',
    blueprint_model: 'openai/gpt-4o',
    analyzer_model: 'anthropic/claude-3',
    chat_model: 'openai/gpt-4o-mini',
    requirement_model: 'openai/gpt-4o',
    planning_model: 'openai/gpt-4o',
    review_model: 'anthropic/claude-3-sonnet',
    documentation_model: 'google/gemini-2.0-flash',
    build_cmd: null,
    test_cmd: null,
    staging_branch: 'staging',
    poll_interval: 60000,
    agent_max_timeout: 1800000,
    max_parallel_jobs: 1,
    max_retries: 3,
    agent_max_retries: 3,
    remove_deleted_containers: 1,
    status: 'stopped',
    pid: null,
  };

  it('maps project.blueprint_model to blueprint_model form field', () => {
    const project = { ...mockProject, blueprint_model: 'anthropic/claude-3-opus' };
    const formData = toFormData(project);
    assert.strictEqual(formData.blueprint_model, 'anthropic/claude-3-opus');
  });

  it('maps project.review_model to review_model form field', () => {
    const project = { ...mockProject, review_model: 'anthropic/claude-3-sonnet' };
    const formData = toFormData(project);
    assert.strictEqual(formData.review_model, 'anthropic/claude-3-sonnet');
  });

  it('maps project.documentation_model to documentation_model form field', () => {
    const project = { ...mockProject, documentation_model: 'google/gemini-2.0-flash' };
    const formData = toFormData(project);
    assert.strictEqual(formData.documentation_model, 'google/gemini-2.0-flash');
  });

  it('uses nullish coalescing fallback to empty string for blueprint_model', () => {
    const project = { ...mockProject, blueprint_model: undefined as unknown as string };
    const formData = toFormData(project);
    assert.strictEqual(formData.blueprint_model, '');
  });

  it('uses nullish coalescing fallback to empty string for review_model', () => {
    const project = { ...mockProject, review_model: undefined as unknown as string };
    const formData = toFormData(project);
    assert.strictEqual(formData.review_model, '');
  });

  it('uses nullish coalescing fallback to empty string for documentation_model', () => {
    const project = { ...mockProject, documentation_model: undefined as unknown as string };
    const formData = toFormData(project);
    assert.strictEqual(formData.documentation_model, '');
  });
});