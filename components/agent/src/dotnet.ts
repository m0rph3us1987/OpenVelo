import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config.js';
import { runCommand, runCommandDirect } from './shell.js';

// ── Detection ────────────────────────────────────────────────────────────────

/** Scan workspace for *.sln or *.csproj files (up to 2 dirs deep). */
export function isDotnetRepo(repoPath: string = CONFIG.REPO_PATH): boolean {
    const maxDepth = 2;

    function scan(dir: string, depth: number): boolean {
        if (depth > maxDepth) return false;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return false; }

        for (const entry of entries) {
            if (entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj'))) {
                return true;
            }
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                if (scan(path.join(dir, entry.name), depth + 1)) return true;
            }
        }
        return false;
    }

    return scan(repoPath, 0);
}

// ── NuGet feed discovery ─────────────────────────────────────────────────────

interface NuGetFeed {
    name: string;
    url: string;
}

/** Find ADO artifact feed URLs in nuget.config files (up to 3 dirs deep). */
export function findAdoFeeds(repoPath: string = CONFIG.REPO_PATH): NuGetFeed[] {
    const feeds: NuGetFeed[] = [];
    const maxDepth = 3;

    function scan(dir: string, depth: number) {
        if (depth > maxDepth) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }

        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase() === 'nuget.config') {
                const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
                // Match <add key="..." value="https://pkgs.dev.azure.com/..." />
                const sourceRegex = /<add\s+key="([^"]+)"\s+value="(https?:\/\/pkgs\.dev\.azure\.com\/[^"]+)"/gi;
                let match: RegExpExecArray | null;
                while ((match = sourceRegex.exec(content)) !== null) {
                    feeds.push({ name: match[1]!, url: match[2]! });
                }
            }
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                scan(path.join(dir, entry.name), depth + 1);
            }
        }
    }

    scan(repoPath, 0);
    return feeds;
}

// ── NuGet feed registration ──────────────────────────────────────────────────

/**
 * Register each ADO feed as a named source in the user-level NuGet config and
 * attach credentials using `dotnet nuget add source`, so `dotnet restore` can
 * authenticate against private feeds without manual XML authoring.
 *
 * If a source name is already registered (add fails), credentials are updated
 * via `dotnet nuget update source` instead.
 */
export async function registerNuGetSources(feeds: NuGetFeed[]): Promise<void> {
    if (feeds.length === 0 || !CONFIG.REPO_PAT) return;

    for (const feed of feeds) {
        const add = await runCommandDirect('dotnet', [
            'nuget', 'add', 'source', feed.url,
            '--name', feed.name,
            '--username', 'openvelo-agent',
            '--password', CONFIG.REPO_PAT,
            '--store-password-in-clear-text',
        ]);

        if (add.code !== 0) {
            // Source name already registered — update credentials instead.
            const update = await runCommandDirect('dotnet', [
                'nuget', 'update', 'source', feed.name,
                '--username', 'openvelo-agent',
                '--password', CONFIG.REPO_PAT,
                '--store-password-in-clear-text',
            ]);
            if (update.code !== 0) {
                console.error(`⚠ Failed to configure NuGet source "${feed.name}".`);
            } else {
                console.log(`NuGet source "${feed.name}" credentials updated.`);
            }
        } else {
            console.log(`NuGet source "${feed.name}" registered.`);
        }
    }
}

// ── Feed connectivity probe ──────────────────────────────────────────────────

/** HTTP-probe each ADO feed's index endpoint with Basic auth. */
export async function testAdoFeedConnectivity(feeds: NuGetFeed[]): Promise<void> {
    if (feeds.length === 0 || !CONFIG.REPO_PAT) return;

    for (const feed of feeds) {
        // ADO v3 feed index URL ends with /index.json; strip it first to avoid duplication
        const indexUrl = feed.url.replace(/\/?index\.json\/?$/, '') + '/index.json';
        const auth = Buffer.from(`openvelo:${CONFIG.REPO_PAT}`).toString('base64');

        try {
            const res = await fetch(indexUrl, {
                headers: { Authorization: `Basic ${auth}` },
            });

            if (res.status === 401) {
                console.error(
                    `⚠ Feed "${feed.name}" returned 401 Unauthorized. ` +
                    `Ensure the ADO_PAT has Packaging (Read) scope.`
                );
            } else if (!res.ok) {
                console.error(
                    `⚠ Feed "${feed.name}" returned HTTP ${res.status}. URL: ${indexUrl}`
                );
            } else {
                console.log(`✓ Feed "${feed.name}" is reachable.`);
            }
        } catch (err: any) {
            console.error(
                `⚠ Feed "${feed.name}" unreachable: ${err.message}`
            );
        }
    }
}

// ── .git/info/excludes patching ──────────────────────────────────────────────

const DOTNET_EXCLUDES = ['bin/', 'obj/', '.vs/', 'TestResults/'];

/** Append .NET build artifact patterns to .git/info/excludes. */
export function ensureLocalExcludes(repoPath: string = CONFIG.REPO_PATH): void {
    const excludesPath = path.join(repoPath, '.git', 'info', 'excludes');
    const infoDir = path.dirname(excludesPath);

    if (!fs.existsSync(infoDir)) {
        fs.mkdirSync(infoDir, { recursive: true });
    }

    const existing = fs.existsSync(excludesPath)
        ? fs.readFileSync(excludesPath, 'utf-8')
        : '';

    const toAdd = DOTNET_EXCLUDES.filter(p => !existing.includes(p));
    if (toAdd.length === 0) return;

    const block = '\n# .NET build artifacts (auto-added by OpenVelo agent)\n'
        + toAdd.join('\n') + '\n';
    fs.appendFileSync(excludesPath, block, 'utf-8');
    console.log(`Patched .git/info/excludes with: ${toAdd.join(', ')}`);
}

// ── Build / restore split ────────────────────────────────────────────────────

/**
 * Detect if a command is a `dotnet build` invocation and, if so, run an
 * explicit `dotnet restore` first followed by `dotnet build --no-restore`.
 * Also injects `/p:NuGetAudit=false` to prevent NU1900 failures from
 * private feeds that don't serve vulnerability data.
 *
 * Returns the same shape as runCommand — { code, output } — with both
 * restore and build output merged and labelled.
 */
export async function runDotnetBuild(
    buildCmd: string,
): Promise<{ code: number | null; output: string }> {
    const sections: string[] = [];

    // Extract any /p: properties from the original command for restore
    const props = buildCmd.match(/\/p:\S+/g) || [];
    const propsStr = props.join(' ');

    // Derive the solution/project target from the command
    // e.g. "dotnet build MySolution.sln -c Release" → "MySolution.sln"
    const parts = buildCmd.replace(/^dotnet\s+build\s*/, '').trim().split(/\s+/);
    const target = parts.find(p => !p.startsWith('-') && !p.startsWith('/')) || '';

    // ── Restore ──────────────────────────────────────────────────────────
    console.log('[restore] Running explicit dotnet restore...');
    const restoreCmd = ['dotnet', 'restore', target, propsStr].filter(Boolean).join(' ');
    const restore = await runCommand(restoreCmd, []);

    if (restore.code !== 0) {
        sections.push(`## [restore] ${restoreCmd}\n\`\`\`\n${restore.output.trim()}\n\`\`\``);
        return { code: restore.code, output: sections.join('\n\n') };
    }
    sections.push(`[restore] succeeded.`);

    // ── Build (no-restore) ───────────────────────────────────────────────
    console.log('[build] Running dotnet build --no-restore...');
    let buildCmdFinal = buildCmd;

    // Append --no-restore if not already present
    if (!buildCmdFinal.includes('--no-restore')) {
        buildCmdFinal += ' --no-restore';
    }
    // Inject NuGetAudit=false if not already present
    if (!buildCmdFinal.includes('NuGetAudit')) {
        buildCmdFinal += ' /p:NuGetAudit=false';
    }

    const build = await runCommand(buildCmdFinal, []);
    if (build.code !== 0) {
        sections.push(`## [build] ${buildCmdFinal}\n\`\`\`\n${build.output.trim()}\n\`\`\``);
    } else {
        sections.push(`[build] succeeded.`);
    }

    return { code: build.code, output: sections.join('\n\n') };
}

// ── Full .NET workspace setup ────────────────────────────────────────────────

/**
 * One-shot .NET setup to be called after the repo is cloned.
 * Skips silently if the repo has no .NET project files.
 */
export async function dotnetSetup(repoPath: string = CONFIG.REPO_PATH): Promise<void> {
    if (!isDotnetRepo(repoPath)) {
        console.log('.NET setup: no .sln or .csproj found — skipping.');
        return;
    }

    console.log('.NET repository detected — running NuGet setup...');

    // 1. Discover ADO NuGet feeds
    const feeds = findAdoFeeds(repoPath);
    if (feeds.length > 0) {
        console.log(`Found ${feeds.length} ADO NuGet feed(s): ${feeds.map(f => f.name).join(', ')}`);

        // 2. Register sources and attach credentials via dotnet nuget CLI
        await registerNuGetSources(feeds);

        // 3. Test connectivity
        await testAdoFeedConnectivity(feeds);
    } else {
        console.log('No ADO NuGet feeds found in nuget.config files.');
    }

    // 4. Patch .git/info/excludes
    ensureLocalExcludes(repoPath);

    // 5. Verify dotnet SDK is available
    const { code } = await runCommand('dotnet', ['--version'], repoPath);
    if (code !== 0) {
        console.error('⚠ dotnet CLI not found in PATH — .NET builds will fail.');
    }
}
