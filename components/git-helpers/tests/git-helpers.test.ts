import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
    branchExists,
    detectDefaultBranchViaRemote,
    getCurrentBranch,
    resolveSymbolicHead,
    resolveDefaultBranch,
} from '../src/index.js';

function initRepo(dir: string, defaultBranch = 'main'): void {
    spawnSync('git', ['init', '--initial-branch', defaultBranch, dir], { stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello', 'utf-8');
    spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

describe('git-helpers', () => {
    let tmpDir: string;
    let bareRemote: string;
    let workRepo: string;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
        bareRemote = path.join(tmpDir, 'remote.git');
        workRepo = path.join(tmpDir, 'work');
        fs.mkdirSync(bareRemote);
        spawnSync('git', ['init', '--bare', bareRemote], { stdio: 'ignore' });
        initRepo(workRepo);
        spawnSync('git', ['remote', 'add', 'origin', bareRemote], { cwd: workRepo, stdio: 'ignore' });
        spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: workRepo, stdio: 'ignore' });
        // `git push -u` alone does not set refs/remotes/origin/HEAD;
        // mirror what `git clone` does by explicitly setting it.
        spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: workRepo, stdio: 'ignore' });
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('resolveSymbolicHead returns refs/remotes/origin/<default>', async () => {
        const result = await resolveSymbolicHead(workRepo);
        assert.strictEqual(result, 'refs/remotes/origin/main');
    });

    it('resolveSymbolicHead returns null when symbolic ref is absent', async () => {
        const tmp = path.join(tmpDir, 'nosym');
        initRepo(tmp, 'develop');
        const result = await resolveSymbolicHead(tmp);
        assert.strictEqual(result, null);
    });

    it('detectDefaultBranchViaRemote falls back when symbolic-ref is unset', async () => {
        const tmp = path.join(tmpDir, 'norc');
        initRepo(tmp, 'develop');
        spawnSync('git', ['remote', 'add', 'origin', bareRemote], { cwd: tmp, stdio: 'ignore' });
        spawnSync('git', ['fetch', 'origin'], { cwd: tmp, stdio: 'ignore' });
        spawnSync('git', ['remote', 'set-head', 'origin', '-d'], { cwd: tmp, stdio: 'ignore' });
        const detected = await detectDefaultBranchViaRemote(tmp);
        assert.ok(detected, 'expected default branch detection to find something');
    });

    it('branchExists recognizes local and origin-prefixed refs', async () => {
        assert.strictEqual(await branchExists(workRepo, 'main'), true);
        assert.strictEqual(await branchExists(workRepo, 'origin/main'), true);
        assert.strictEqual(await branchExists(workRepo, 'origin/does-not-exist'), false);
        assert.strictEqual(await branchExists(workRepo, 'does-not-exist'), false);
    });

    it('getCurrentBranch returns the active branch', async () => {
        const branch = await getCurrentBranch(workRepo);
        assert.strictEqual(branch, 'main');
    });

    it('resolveDefaultBranch prefers symbolic ref over remote show', async () => {
        const result = await resolveDefaultBranch(workRepo);
        assert.strictEqual(result, 'main');
    });
});
