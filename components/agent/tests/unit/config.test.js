import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CONFIG, applyHandshake } from '../../src/config.js';
describe('applyHandshake', () => {
    const originalCONFIG = { ...CONFIG };
    before(() => {
        Object.assign(CONFIG, originalCONFIG);
    });
    after(() => {
        Object.assign(CONFIG, originalCONFIG);
    });
    it('correctly sets all four CONFIG model fields', () => {
        const handshake = {
            repo_url: 'https://github.com/test/repo',
            backend: 'opencode',
            execution_model: 'gpt-execution',
            blueprint_model: 'gpt-blueprint',
            review_model: 'gpt-review',
            documentation_model: 'gpt-docs',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
        };
        applyHandshake(handshake);
        assert.strictEqual(CONFIG.BACKEND_MODEL, 'gpt-execution');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, 'gpt-blueprint');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, 'gpt-review');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, 'gpt-docs');
    });
    it('sets empty string for model fields that are null', () => {
        const handshake = {
            repo_url: 'https://github.com/test/repo',
            backend: 'opencode',
            execution_model: null,
            blueprint_model: null,
            review_model: null,
            documentation_model: null,
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
        };
        applyHandshake(handshake);
        assert.strictEqual(CONFIG.BACKEND_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, '');
    });
    it('sets empty string for model fields that are undefined', () => {
        const handshake = {
            repo_url: 'https://github.com/test/repo',
            backend: 'opencode',
            execution_model: undefined,
            blueprint_model: undefined,
            review_model: undefined,
            documentation_model: undefined,
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
        };
        applyHandshake(handshake);
        assert.strictEqual(CONFIG.BACKEND_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, '');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, '');
    });
    it('preserves existing behavior for non-model fields', () => {
        const handshake = {
            repo_url: 'https://github.com/test/repo',
            repo_host: 'github',
            repo_pat: 'test-pat',
            backend: 'opencode',
            execution_model: 'gpt-execution',
            blueprint_model: 'gpt-blueprint',
            review_model: 'gpt-review',
            documentation_model: 'gpt-docs',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
            job_title: 'Test Job',
            story: 'Test story content',
        };
        applyHandshake(handshake);
        assert.strictEqual(CONFIG.REPO_URL, 'https://github.com/test/repo');
        assert.strictEqual(CONFIG.REPO_HOST, 'github');
        assert.strictEqual(CONFIG.REPO_PAT, 'test-pat');
        assert.strictEqual(CONFIG.BACKEND, 'opencode');
        assert.strictEqual(CONFIG.BUILD_CMD, 'npm run build');
        assert.strictEqual(CONFIG.TEST_CMD, 'npm test');
        assert.strictEqual(CONFIG.STAGING_BRANCH, 'staging');
        assert.strictEqual(CONFIG.JOB_TITLE, 'Test Job');
        assert.strictEqual(CONFIG.STORY_CONTENT, 'Test story content');
    });
    it('handshake config interface includes all four model fields with correct snake_case names', () => {
        const handshake = {
            repo_url: 'https://github.com/test/repo',
            backend: 'opencode',
            execution_model: 'model-exec',
            blueprint_model: 'model-blue',
            review_model: 'model-rev',
            documentation_model: 'model-doc',
            build_cmd: 'npm run build',
            test_cmd: 'npm test',
            staging_branch: 'staging',
        };
        applyHandshake(handshake);
        assert.strictEqual(CONFIG.BACKEND_MODEL, 'model-exec');
        assert.strictEqual(CONFIG.BACKEND_BLUEPRINT_MODEL, 'model-blue');
        assert.strictEqual(CONFIG.BACKEND_REVIEW_MODEL, 'model-rev');
        assert.strictEqual(CONFIG.BACKEND_DOCUMENTATION_MODEL, 'model-doc');
    });
});
//# sourceMappingURL=config.test.js.map