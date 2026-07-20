import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { spawn } from 'child_process';
import {
    assertSharedRepoBound,
    resetToStaging,
    type RunCommandFn,
} from '../src/index.js';

function initRepo(dir: string, defaultBranch = 'main'): void {
    spawnSync('git', ['init', '--initial-branch', defaultBranch, dir], { stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello', 'utf-8');
    spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

function makeRunCommand(): { fn: RunCommandFn; calls: Array<{ cmd: string; args: string[]; cwd: string }> } {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const fn: RunCommandFn = async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        const full = `${cmd} ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
        const r = spawnSync(full, { cwd, shell: '/bin/bash', encoding: 'utf8' });
        return { code: r.status, output: `${r.stdout}${r.stderr}` };
    };
    return { fn, calls };
}

describe('assertSharedRepoBound', () => {
    it('throws when .git is missing', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-share-'));
        try {
            assert.throws(
                () => assertSharedRepoBound(tmp),
                /shared_repo bind missing or empty/,
            );
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('returns silently when .git exists', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-share-'));
        try {
            initRepo(tmp);
            assert.doesNotThrow(() => assertSharedRepoBound(tmp));
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('resetToStaging (contract test, no real gbfs)', () => {
    let tmpDir: string;
    let bareRemote: string;
    let sharedRepo: string;
    let repoPath: string;
    let originalGbfsEnv: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-reset-'));
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

        originalGbfsEnv = process.env.GBFS_BINARY;
        // Point GBFS_BINARY at a fake script that creates a `.git`
        // directory under repoPath after a small delay — enough to
        // satisfy waitForGbfsMount without requiring a real FUSE driver.
        const fakeBin = path.join(tmpDir, 'fake-gbfs');
        fs.writeFileSync(
            fakeBin,
            `#!/usr/bin/env bash\nsleep 0.1\nmkdir -p "$3/.git"\necho "fake-gbfs mount $2 $3"\n`,
            { mode: 0o755 },
        );
        process.env.GBFS_BINARY = fakeBin;
    });

    afterEach(() => {
        // Best-effort cleanup. The fake-gbfs process exits quickly, but
        // there may be transient locks; ignore EBUSY and retry once.
        if (!tmpDir) return;
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (err: any) {
            if (err && err.code === 'EBUSY') {
                setTimeout(() => {
                    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
                }, 50).unref();
            }
        }
        tmpDir = '';
        if (originalGbfsEnv === undefined) delete process.env.GBFS_BINARY;
        else process.env.GBFS_BINARY = originalGbfsEnv;
    });

    it('fails fast when shared_repo has no .git', async () => {
        const { fn } = makeRunCommand();
        fs.rmSync(path.join(sharedRepo, '.git'), { recursive: true, force: true });
        await assert.rejects(
            () => resetToStaging({ sharedRepoPath: sharedRepo, repoPath, stagingBranch: 'main', runCommand: fn }),
            /shared_repo bind missing or empty/,
        );
    });

    it('fails fast when gbfs binary cannot be found', async () => {
        const { fn } = makeRunCommand();
        delete process.env.GBFS_BINARY;
        await assert.rejects(
            () => resetToStaging({ sharedRepoPath: sharedRepo, repoPath, stagingBranch: 'main', runCommand: fn }),
            /gbfs binary not found/,
        );
    });

    it('runs git fetch and gbfs mount and emits the remote-wins checkout', async () => {
        const { fn, calls } = makeRunCommand();
        await resetToStaging({ sharedRepoPath: sharedRepo, repoPath, stagingBranch: 'main', runCommand: fn });
        const cmds = calls.map((c) => `${c.cmd} ${c.args[0]}`);
        assert.ok(cmds.includes('git fetch'), `expected git fetch in ${cmds.join(',')}`);
        assert.ok(cmds.includes('git checkout'), `expected git checkout in ${cmds.join(',')}`);
        // The remote-wins branch should be a `git checkout -B main origin/main`.
        const remoteWin = calls.find(
            (c) => c.cmd === 'git' && c.args[0] === 'checkout' && c.args[1] === '-B' && c.args[2] === 'main' && c.args[3] === 'origin/main',
        );
        assert.ok(remoteWin, 'expected checkout -B main origin/main for remote-wins reset');
    });
});
