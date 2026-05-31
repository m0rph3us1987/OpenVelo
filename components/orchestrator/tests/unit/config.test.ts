import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CONFIG, applyProjectConfig, ProjectConfig } from '../../src/config.js';

describe('applyProjectConfig', () => {
    const originalCONFIG = { ...CONFIG };

    before(() => {
        Object.assign(CONFIG, originalCONFIG);
    });

    after(() => {
        Object.assign(CONFIG, originalCONFIG);
    });

    it('correctly sets all four CONFIG model fields', () => {
        const project: ProjectConfig = {
            id: 1,
            port: 3001,
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: 'test-pat',
            docker_image: 'openvelo-agent:linux',
            backend: 'opencode',
            execution_model: 'gpt-execution',
            blueprint_model: 'gpt-blueprint',
            review_model: 'gpt-review',
            documentation_model: 'gpt-docs',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
            poll_interval: 60000,
            agent_max_timeout: 1800000,
            max_parallel_jobs: 1,
            max_retries: 3,
            agent_max_retries: 3,
            remove_deleted_containers: true,
        };

        applyProjectConfig(project);

        assert.strictEqual(CONFIG.BACKEND_MODEL, 'gpt-execution');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, 'gpt-blueprint');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, 'gpt-review');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, 'gpt-docs');
    });

    it('sets empty string for model fields that are null', () => {
        const project: ProjectConfig = {
            id: 2,
            port: 3001,
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: null,
            docker_image: 'openvelo-agent:linux',
            backend: 'opencode',
            execution_model: null,
            blueprint_model: null,
            review_model: null,
            documentation_model: null,
            build_cmd: null,
            test_cmd: null,
            staging_branch: 'staging',
            poll_interval: 60000,
            agent_max_timeout: 1800000,
            max_parallel_jobs: 1,
            max_retries: 3,
            agent_max_retries: 3,
            remove_deleted_containers: true,
        };

        applyProjectConfig(project);

        assert.strictEqual(CONFIG.BACKEND_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, '');
    });

    it('sets empty string for model fields that are undefined', () => {
        const project = {
            id: 3,
            port: 3001,
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: undefined,
            docker_image: 'openvelo-agent:linux',
            backend: 'opencode',
            execution_model: undefined,
            blueprint_model: undefined,
            review_model: undefined,
            documentation_model: undefined,
            build_cmd: undefined,
            test_cmd: undefined,
            staging_branch: 'staging',
            poll_interval: 60000,
            agent_max_timeout: 1800000,
            max_parallel_jobs: 1,
            max_retries: 3,
            agent_max_retries: 3,
            remove_deleted_containers: true,
        } as unknown as ProjectConfig;

        applyProjectConfig(project);

        assert.strictEqual(CONFIG.BACKEND_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, '');
    });

    it('preserves existing behavior for non-model fields', () => {
        const project: ProjectConfig = {
            id: 4,
            port: 3001,
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: 'test-pat',
            docker_image: 'openvelo-agent:linux',
            backend: 'opencode',
            execution_model: 'gpt-execution',
            blueprint_model: 'gpt-blueprint',
            review_model: 'gpt-review',
            documentation_model: 'gpt-docs',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
            poll_interval: 60000,
            agent_max_timeout: 1800000,
            max_parallel_jobs: 1,
            max_retries: 3,
            agent_max_retries: 3,
            remove_deleted_containers: true,
        };

        applyProjectConfig(project);

        assert.strictEqual(CONFIG.REPO_URL, 'https://test-pat@github.com/test/repo');
        assert.strictEqual(CONFIG.REPO_HOST, 'github');
        assert.strictEqual(CONFIG.REPO_PAT, 'test-pat');
        assert.strictEqual(CONFIG.BACKEND, 'opencode');
        assert.strictEqual(CONFIG.DOCKER_IMAGE, 'openvelo-agent:linux');
        assert.strictEqual(CONFIG.BUILD_CMD, 'npm run build');
        assert.strictEqual(CONFIG.TEST_CMD, 'npm test');
        assert.strictEqual(CONFIG.STAGING_BRANCH, 'staging');
        assert.strictEqual(CONFIG.POLL_INTERVAL, 60000);
        assert.strictEqual(CONFIG.AGENT_MAX_TIMEOUT, 1800000);
        assert.strictEqual(CONFIG.MAX_PARALLEL_JOBS, 1);
        assert.strictEqual(CONFIG.MAX_RETRIES, 3);
        assert.strictEqual(CONFIG.AGENT_MAX_RETRIES, 3);
        assert.strictEqual(CONFIG.REMOVE_DELETED_CONTAINERS, true);
        assert.strictEqual(CONFIG.PROJECT_ID, 4);
    });

    it('handshake config object includes all four model fields with correct snake_case names', () => {
        const project: ProjectConfig = {
            id: 5,
            port: 3001,
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: 'test-pat',
            docker_image: 'openvelo-agent:linux',
            backend: 'opencode',
            execution_model: 'model-exec',
            blueprint_model: 'model-blue',
            review_model: 'model-rev',
            documentation_model: 'model-doc',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
            poll_interval: 60000,
            agent_max_timeout: 1800000,
            max_parallel_jobs: 1,
            max_retries: 3,
            agent_max_retries: 3,
            remove_deleted_containers: true,
        };

        applyProjectConfig(project);

        const handshakeConfig = {
            repo_url: CONFIG.REPO_URL,
            repo_host: CONFIG.REPO_HOST,
            repo_pat: CONFIG.REPO_PAT,
            backend: CONFIG.BACKEND,
            execution_model: CONFIG.BACKEND_MODEL,
            blueprint_model: CONFIG.BACKEND_BLUEPRINT_MODEL,
            review_model: CONFIG.BACKEND_REVIEW_MODEL,
            documentation_model: CONFIG.BACKEND_DOCUMENTATION_MODEL,
            build_cmd: CONFIG.BUILD_CMD,
            test_cmd: CONFIG.TEST_CMD,
            staging_branch: CONFIG.STAGING_BRANCH,
        };

        assert.strictEqual(handshakeConfig.execution_model, 'model-exec');
        assert.strictEqual(handshakeConfig.blueprint_model, 'model-blue');
        assert.strictEqual(handshakeConfig.review_model, 'model-rev');
        assert.strictEqual(handshakeConfig.documentation_model, 'model-doc');
    });
});