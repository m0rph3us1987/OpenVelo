import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Bitbucket URL parsing', () => {
    it('extracts workspace and repo_slug from standard Bitbucket URL', () => {
        const repoUrl = 'https://bitbucket.org/m0rph3us1987/sweetvault.git';
        const repoParts = repoUrl.split('/');
        if (repoParts.length < 2) throw new Error('Invalid REPO_URL');
        const repo_slug = repoParts.pop()!.replace('.git', '');
        const workspace = repoParts.pop()!;
        if (!workspace || !repo_slug) throw new Error('Invalid REPO_URL');
        assert.strictEqual(workspace, 'm0rph3us1987');
        assert.strictEqual(repo_slug, 'sweetvault');
    });

    it('extracts workspace and repo_slug without .git suffix', () => {
        const repoUrl = 'https://bitbucket.org/workspace/repo';
        const repoParts = repoUrl.split('/');
        if (repoParts.length < 2) throw new Error('Invalid REPO_URL');
        const repo_slug = repoParts.pop()!.replace('.git', '');
        const workspace = repoParts.pop()!;
        if (!workspace || !repo_slug) throw new Error('Invalid REPO_URL');
        assert.strictEqual(workspace, 'workspace');
        assert.strictEqual(repo_slug, 'repo');
    });

    it('strips .git suffix from repo_slug', () => {
        const repoUrl = 'https://bitbucket.org/owner/my-repo.git';
        const repoParts = repoUrl.split('/');
        if (repoParts.length < 2) throw new Error('Invalid REPO_URL');
        const repo_slug = repoParts.pop()!.replace('.git', '');
        const workspace = repoParts.pop()!;
        if (!workspace || !repo_slug) throw new Error('Invalid REPO_URL');
        assert.strictEqual(workspace, 'owner');
        assert.strictEqual(repo_slug, 'my-repo');
    });

    it('throws Invalid REPO_URL when fewer than 2 path segments', () => {
        const testFn = () => {
            const repoUrl = 'https://bitbucket.org';
            const repoParts = repoUrl.split('/');
            if (repoParts.length < 2) throw new Error('Invalid REPO_URL');
            const repo_slug = repoParts.pop()!.replace('.git', '');
            const workspace = repoParts.pop()!;
            if (!workspace || !repo_slug) throw new Error('Invalid REPO_URL');
        };
        assert.throws(testFn, /Invalid REPO_URL/);
    });

    it('throws Invalid REPO_URL when repo_slug is empty (trailing slash)', () => {
        const testFn = () => {
            const repoUrl = 'https://bitbucket.org/workspace/';
            const repoParts = repoUrl.split('/');
            if (repoParts.length < 2) throw new Error('Invalid REPO_URL');
            const repo_slug = repoParts.pop()!.replace('.git', '');
            const workspace = repoParts.pop()!;
            if (!workspace || !repo_slug) throw new Error('Invalid REPO_URL');
        };
        assert.throws(testFn, /Invalid REPO_URL/);
    });
});