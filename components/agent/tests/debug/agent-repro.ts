// Debug script: spawns the agent locally with the same env vars the
// orchestrator would set, then connects as a WebSocket client and sends
// a handshake using project 1's config + job 37's data.
//
// Tests the DIRECT-ACI approach: opencode-server.ts spawns `kilo acp`
// via AcpBridge.start() — no shim, no in-process HTTP server, no
// renamed binary. The `kilo` binary is found on the regular PATH.
//
// Usage:  npx tsx tests/debug/agent-repro.ts

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_DIR = path.resolve(__dirname, '../../');
const REPO_DIR = '/tmp/agent-debug-repo';
const STORY_PATH = '/tmp/agent-debug-story.md';
const FAKE_HOME = '/tmp/agent-debug-home';
const HANDLER_PORT = 13001;

function log(msg: string): void { console.log(`[debug] ${msg}`); }

// Clean up any leftover state from previous runs
for (const p of [REPO_DIR, FAKE_HOME]) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// Create a fake HOME for kilo to write its config to (the real kilo
// defaults to $HOME/.local/share/kilo, which as root is /root, but
// we're running as the local user).
fs.mkdirSync(path.join(FAKE_HOME, '.local', 'share', 'kilo'), { recursive: true });
fs.mkdirSync(path.join(FAKE_HOME, '.config', 'kilo'), { recursive: true });
fs.writeFileSync(path.join(FAKE_HOME, '.local', 'share', 'kilo', 'auth.json'), '{"provider":"test","token":"x"}');

// Create a fake repo
fs.mkdirSync(REPO_DIR, { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'README.md'), '# Debug repo\n');
spawn('git', ['init', '-q'], { cwd: REPO_DIR });
spawn('git', ['config', 'user.email', 'test@test.com'], { cwd: REPO_DIR });
spawn('git', ['config', 'user.name', 'Test'], { cwd: REPO_DIR });
spawn('git', ['add', '.'], { cwd: REPO_DIR });
spawn('git', ['commit', '-q', '-m', 'init'], { cwd: REPO_DIR });

// Project 1 + job 37 config (from the SQLite DB)
const HANDSHAKE = {
    repo_url: 'https://git.bytechaos.de:3000/m0rph3us1987/OpenVelo.git',
    repo_host: 'gitea',
    repo_pat: '',
    backend: 'kilo',
    execution_model: '',
    blueprint_model: '',
    review_model: '',
    documentation_model: '',
    build_cmd: 'npm run build',
    test_cmd: 'npm test',
    staging_branch: 'Visuals',
    job_title: 'Database Schema & Security Mode Registration',
    story: '# Debug Story\n\nDo a small thing.',
};

// Spawn the agent process. No shim dir in PATH — the agent just calls
// `kilo acp` directly via AcpBridge, and `kilo` resolves to whatever
// the npm-global install put on PATH.
const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    AGENT_PORT: String(HANDLER_PORT),
    JOB_ID: '37-debug',
    AGENT_MAX_RETRIES: '3',
    REPO_PATH: REPO_DIR,
    STORY_PATH: STORY_PATH,
    HOME: FAKE_HOME,
    USER: 'm0rph3us1987',
    // Make sure npm-global bin dir comes first so the real `kilo` wins.
    PATH: `/usr/local/lib/node_modules/.bin:/usr/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:${process.env['PATH'] ?? ''}`,
};

log(`spawning agent from ${AGENT_DIR}`);
const proc: ChildProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: AGENT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
});

let ws: WebSocket | null = null;
let handshakeSent = false;
let timeout: NodeJS.Timeout | null = null;

const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    try { ws?.close(); } catch { /* ignore */ }
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 200);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    process.stdout.write(`[agent stdout] ${text}`);
    if (text.includes('Handshake received') && !handshakeSent) {
        handshakeSent = true;
    }
    if (text.includes('kilo acp initialized successfully')) {
        log('✓ kilo acp subprocess ready');
    }
});

proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[agent stderr] ${chunk.toString()}`);
});

proc.on('exit', (code, signal) => {
    log(`agent exited code=${code} signal=${signal}`);
    cleanup();
});

function connectWithBackoff(): void {
    log(`connecting WS to ws://127.0.0.1:${HANDLER_PORT}`);
    ws = new WebSocket(`ws://127.0.0.1:${HANDLER_PORT}`);
    ws.on('open', () => {
        log('WS open — sending handshake');
        setTimeout(() => {
            try { ws?.send(JSON.stringify({ type: 'handshake', config: HANDSHAKE })); }
            catch (err) { log(`failed to send handshake: ${err}`); }
        }, 100);
    });
    ws.on('message', (data: Buffer) => process.stdout.write(`[ws msg] ${data.toString()}\n`));
    ws.on('close', () => log('WS closed'));
    ws.on('error', (err) => {
        log(`WS error: ${err.message} — retrying in 1s`);
        setTimeout(connectWithBackoff, 1000);
    });
}
connectWithBackoff();

timeout = setTimeout(() => { log('timeout (90s) — killing'); cleanup(); }, 90_000);
