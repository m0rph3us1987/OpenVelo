import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateFinalRepoURL } from '@/api/routes/projects';

describe('generateFinalRepoURL', () => {
    it('uses username=token for github host', () => {
        const result = generateFinalRepoURL('https://github.com/owner/repo.git', 'my-pat', 'github');
        assert.strictEqual(result, 'https://token:my-pat@github.com/owner/repo.git');
    });

    it('uses username=token for gitea host', () => {
        const result = generateFinalRepoURL('https://gitea.example.com/owner/repo.git', 'my-pat', 'gitea');
        assert.strictEqual(result, 'https://token:my-pat@gitea.example.com/owner/repo.git');
    });

    it('uses username=token for azure-devops host', () => {
        const result = generateFinalRepoURL('https://dev.azure.com/org/project/_git/repo', 'my-pat', 'azure-devops');
        assert.strictEqual(result, 'https://token:my-pat@dev.azure.com/org/project/_git/repo');
    });

    it('uses username=x-token-auth for bitbucket host', () => {
        const result = generateFinalRepoURL('https://bitbucket.org/workspace/repo_slug.git', 'my-pat', 'bitbucket');
        assert.strictEqual(result, 'https://x-token-auth:my-pat@bitbucket.org/workspace/repo_slug.git');
    });

    it('returns original url when repoPat is empty string', () => {
        const url = 'https://github.com/owner/repo.git';
        const result = generateFinalRepoURL(url, '', 'github');
        assert.strictEqual(result, url);
    });

    it('returns original url when repoPat is null', () => {
        const url = 'https://github.com/owner/repo.git';
        const result = generateFinalRepoURL(url, null as unknown as string, 'github');
        assert.strictEqual(result, url);
    });

    it('returns original url when repoPat is undefined', () => {
        const url = 'https://github.com/owner/repo.git';
        const result = generateFinalRepoURL(url, undefined as unknown as string, 'github');
        assert.strictEqual(result, url);
    });

    it('returns original url when repoUrl is malformed', () => {
        const result = generateFinalRepoURL('not-a-valid-url', 'my-pat', 'github');
        assert.strictEqual(result, 'not-a-valid-url');
    });
});