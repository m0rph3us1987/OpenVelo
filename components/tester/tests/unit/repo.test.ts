import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CONFIG } from '../../src/config.js';
import { mountAndReset } from '../../src/repo.js';
// mountAndReset internally imports from '../../git-helpers/dist/index.js';
// make sure the package is built before running tests.

function initRepo(dir: string, defaultBranch = 'main'): void {
    spawnSync('git', ['init', '--initial-branch', defaultBranch, dir], { stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello', 'utf-8');
    spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

describe('tester mountAndReset shared_repo contract', () => {
    let tmpDir: string;
    let bareRemote: string;
    let sharedRepo: string;
    let repoPath: string;
    let originalRepoPath: string;
    let originalRepoBranch: string;
    let originalSharedEnv: string | undefined;
    let originalGbfsEnv: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-repo-'));
        bareRemote = path.join(tmpDir, 'remote.git');
        sharedRepo = path.join(tmpDir, 'shared_repo');
        repoPath = path.join(tmpDir, 'repo');

        fs.mkdirSync(bareRemote);
        spawnSync('git', ['init', '--bare', bareRemote], { stdio: 'ignore' });

        fs.mkdirSync(sharedRepo);
        initRepo(sharedRepo);
        spawnSync('git', ['remote', 'add', 'origin', bareRemote], { cwd: sharedRepo, stdio: 'ignore' });
        spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: sharedRepo, stdio: 'ignore' });
        fs.mkdirSync(repoPath);

        // Fake gbfs that creates `<repoPath>/.git` to satisfy waitForGbfsMount.
        const fakeBin = path.join(tmpDir, 'fake-gbfs');
        fs.writeFileSync(
            fakeBin,
            `#!/usr/bin/env bash\nsleep 0.1\nmkdir -p "$3/.git"\n`,
            { mode: 0o755 },
        );

        originalRepoPath = CONFIG.REPO_PATH;
        originalRepoBranch = CONFIG.REPO_BRANCH;
        originalSharedEnv = process.env.SHARED_REPO_PATH;
        originalGbfsEnv = process.env.GBFS_BINARY;

        CONFIG.REPO_PATH = repoPath;
        CONFIG.REPO_BRANCH = 'main';
        process.env.SHARED_REPO_PATH = sharedRepo;
        process.env.GBFS_BINARY = fakeBin;
    });

    after(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        CONFIG.REPO_PATH = originalRepoPath;
        CONFIG.REPO_BRANCH = originalRepoBranch;
        if (originalSharedEnv === undefined) delete process.env.SHARED_REPO_PATH;
        else process.env.SHARED_REPO_PATH = originalSharedEnv;
        if (originalGbfsEnv === undefined) delete process.env.GBFS_BINARY;
        else process.env.GBFS_BINARY = originalGbfsEnv;
    });

    it('fails fast when /shared_repo has no .git', async () => {
        fs.rmSync(path.join(sharedRepo, '.git'), { recursive: true, force: true });
        await assert.rejects(
            () => mountAndReset(),
            /shared_repo bind missing or empty/,
        );
    });

    it('completes the mount+reset cycle when shared_repo is valid', async () => {
        await mountAndReset();
        // After the fake-gbfs mounts, the repo dir should expose `.git`.
        assert.ok(
            fs.existsSync(path.join(repoPath, '.git')),
            `expected ${path.join(repoPath, '.git')} to exist after mountAndReset`,
        );
    });
});
