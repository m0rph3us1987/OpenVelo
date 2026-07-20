import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

/**
 * Resolve the gbfs binary. Honors:
 *   - GBFS_BINARY env override (always wins)
 *   - /gbfs/gbfs — the staged-in location from scripts/stage-gbfs.mjs
 *   - which gbfs — relies on PATH
 * Returns null if no candidate is found.
 */
export function resolveGbfsBinary(): string | null {
    const fromEnv = process.env.GBFS_BINARY;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    if (fs.existsSync('/gbfs/gbfs')) return '/gbfs/gbfs';
    try {
        const result = spawnSync('which', ['gbfs'], { encoding: 'utf8', timeout: 2000 });
        if (result.status === 0) {
            const v = result.stdout.trim();
            if (v) return v;
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * Poll `mountPoint/.git` until it appears, mirroring web-ui's
 * `waitForGbfsMount` in `repo-clone.ts`. Returns when the file shows
 * up; rejects with a clear error on timeout.
 */
export function waitForGbfsMount(mountPoint: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const probe = path.join(mountPoint, '.git');
        const tick = () => {
            if (fs.existsSync(probe)) {
                resolve();
                return;
            }
            if (Date.now() >= deadline) {
                reject(new Error(`gbfs mount did not become ready at ${mountPoint} within ${timeoutMs}ms`));
                return;
            }
            setTimeout(tick, 100);
        };
        tick();
    });
}

/**
 * Validate that the orchestrator's shared_repo bind actually exposes
 * a real clone. Failing fast is better than silently self-cloning,
 * which would defeat the cache and mask a misconfigured bind.
 */
export function assertSharedRepoBound(sharedRepoPath: string): void {
    const sharedRepoGitDir = path.join(sharedRepoPath, '.git');
    if (!fs.existsSync(sharedRepoGitDir)) {
        throw new Error(
            `shared_repo bind missing or empty at ${sharedRepoPath}: ${sharedRepoGitDir} not found. ` +
            `The orchestrator must bind the project cache (shared_repos/<projectId>/repository) into the container at ${sharedRepoPath}.`,
        );
    }
}

/**
 * Spawn `gbfs mount <branch> <repoPath>` with cwd set to the shared
 * repo, detached so the FUSE process survives the caller awaiting,
 * and stdio piped to /dev/null. Mirrors web-ui's mount call in
 * `repo-clone.ts:621-626`.
 */
export function spawnGbfsMount(stagingBranch: string, repoPath: string, sharedRepoPath: string): ReturnType<typeof spawn> {
    return spawn('gbfs', ['mount', stagingBranch, repoPath], {
        cwd: sharedRepoPath,
        stdio: 'ignore',
        detached: true,
    });
}
