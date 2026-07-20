import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_CANDIDATES = [
    '/gbfs/gbfs',
    '/gbfs/gbfs.exe',
    'C:\\gbfs\\gbfs.exe',
    'gbfs',
    'gbfs.exe',
];

function resolveBinary(): string | null {
    const fromEnv = process.env.OPENVELO_GBFS_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    for (const candidate of DEFAULT_CANDIDATES) {
        if (candidate.includes(path.sep) || candidate.includes('/') || candidate.includes('\\')) {
            try {
                if (fs.existsSync(candidate)) return candidate;
            } catch {
                // ignore
            }
        }
    }

    const which = process.platform === 'win32' ? 'where' : 'which';
    const lookup = spawnSync(which, ['gbfs'], { encoding: 'utf8' });
    if (lookup.status === 0) {
        const resolved = lookup.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (resolved) return resolved;
    }
    return null;
}

export interface GbfsCheckResult {
    ok: boolean;
    path: string | null;
    version: string | null;
    error: string | null;
}

export function checkGbfs(): GbfsCheckResult {
    const binary = resolveBinary();
    if (!binary) {
        return {
            ok: false,
            path: null,
            version: null,
            error:
                'gbfs binary not found. Expected at /gbfs/gbfs (or /gbfs/gbfs.exe on Windows), ' +
                'or on PATH. Set OPENVELO_GBFS_PATH to override.',
        };
    }

    // `gbfs` does not have a real --help flag; both `--help` and bare
    // invocation print the usage banner and exit non-zero. We treat any
    // successful spawn (i.e. no spawnSync.error) as "the binary runs and
    // initialized libgit2/jansson/fuse3" — which is the real readiness
    // signal we need. The version banner `GitBranchFS version X.Y.Z` is
    // always emitted on stdout regardless of argv.
    const probe = spawnSync(binary, [], { encoding: 'utf8' });
    if (probe.error) {
        return {
            ok: false,
            path: binary,
            version: null,
            error: `gbfs found at ${binary} but failed to execute: ${probe.error.message}`,
        };
    }

    const combined = `${probe.stdout || ''}\n${probe.stderr || ''}`;
    if (!/GitBranchFS/i.test(combined)) {
        return {
            ok: false,
            path: binary,
            version: null,
            error: `gbfs at ${binary} ran but did not emit a recognized banner. ` +
                `stdout=${(probe.stdout || '').slice(0, 200).trim()} ` +
                `stderr=${(probe.stderr || '').slice(0, 200).trim()}`,
        };
    }

    const versionMatch = combined.match(/version\s+v?(\d+\.\d+\.\d+)/i);
    return {
        ok: true,
        path: binary,
        version: versionMatch && versionMatch[1] ? versionMatch[1] : null,
        error: null,
    };
}

export function assertGbfsInstalled(componentName: string): void {
    const result = checkGbfs();
    if (result.ok) {
        console.log(
            `[startup] gbfs OK (${result.path}${result.version ? `, v${result.version}` : ''})`
        );
        return;
    }
    console.error(
        `[startup] FATAL: ${componentName} requires gbfs but it is not available. ${result.error}`
    );
    process.exit(1);
}