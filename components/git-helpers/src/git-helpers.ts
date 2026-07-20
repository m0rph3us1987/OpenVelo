import { spawn } from 'child_process';

function runGit(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => { stdout += d.toString(); });
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.on('error', () => resolve({ code: 1, stdout, stderr }));
    });
}

/**
 * Read the symbolic ref `refs/remotes/origin/HEAD` (set by `git clone`
 * and refreshed by `git fetch`). Returns the full ref (e.g.
 * `refs/remotes/origin/main`) or null if it is not set.
 */
export async function resolveSymbolicHead(cwd: string): Promise<string | null> {
    const { code, stdout } = await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
    if (code !== 0) return null;
    const v = stdout.trim();
    return v || null;
}

/**
 * Fallback default-branch discovery for older repos where
 * `origin/HEAD` is not set: parse `git remote show origin` for the
 * `HEAD branch: <name>` line.
 */
export async function detectDefaultBranchViaRemote(cwd: string): Promise<string | null> {
    const { code, stdout } = await runGit(['remote', 'show', 'origin'], cwd);
    if (code !== 0) return null;
    const match = stdout.match(/HEAD branch:\s*([^\s]+)/i);
    return match && match[1] ? match[1] : null;
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
    const { code, stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (code !== 0) return null;
    const v = stdout.trim();
    if (!v || v === 'HEAD') return null;
    return v;
}

/**
 * Accept both local branches (`main`) and remote-tracking branches
 * (`origin/main`). Normalize to the right ref namespace before checking.
 */
export async function branchExists(cwd: string, branch: string): Promise<boolean> {
    const ref = branch.startsWith('origin/')
        ? `refs/remotes/${branch}`
        : `refs/heads/${branch}`;
    const { code } = await runGit(['rev-parse', '--verify', '--quiet', ref], cwd);
    return code === 0;
}
