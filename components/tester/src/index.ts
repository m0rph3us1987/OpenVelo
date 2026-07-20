import * as http from 'http';
import { messenger } from './messenger.js';
import { WorkflowEngine } from './workflow.js';
import { CONFIG, applyEnvConfig, isDebugMode } from './config.js';
import { assertGbfsInstalled } from './gbfs-check.js';

assertGbfsInstalled('tester');

const _origStdoutWrite = process.stdout.write.bind(process.stdout);
const _origStderrWrite = process.stderr.write.bind(process.stderr);
let _inMessengerLog = false;

process.stdout.write = (chunk: string | Uint8Array, ...args: any[]) => {
    const str = String(chunk);
    if (!_inMessengerLog) {
        _inMessengerLog = true;
        messenger.log(str, 'stdout');
        _inMessengerLog = false;
    }
    return _origStdoutWrite(chunk, ...args);
};

process.stderr.write = (chunk: string | Uint8Array, ...args: any[]) => {
    const str = String(chunk);
    if (!_inMessengerLog) {
        _inMessengerLog = true;
        messenger.log(str, 'stderr');
        _inMessengerLog = false;
    }
    return _origStderrWrite(chunk, ...args);
};

console.log('--- OpenVelo Tester Rewrite Startup ---');
if (isDebugMode()) {
    console.log('Mode: DEBUG (no orchestrator WS; will run setup, then park)');
} else {
    console.log(`Mode: SERVER (orchestrator WS on port ${CONFIG.TESTER_PORT})`);
    console.log(`Job ID: ${CONFIG.JOB_ID}`);
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

function waitForShutdown(server: http.Server): Promise<void> {
    return new Promise((resolve) => {
        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            console.log('\n[debug] shutdown signal received; exiting.');
            resolve();
        };
        const closeAndFinish = () => {
            server.close(() => finish());
            setTimeout(finish, 500).unref();
        };
        process.on('SIGTERM', closeAndFinish);
        process.on('SIGINT', closeAndFinish);
        process.on('SIGHUP', closeAndFinish);
    });
}

async function runDebugMode(): Promise<void> {
    console.log('[debug] TESTER_DEBUG=true — manual inspection mode.');
    console.log('[debug] No orchestrator WS handshake. Loading config from DEBUG_* env aliases.');
    console.log('[debug] Running the production setup stage (clone + kilo.json + setup.sh),');
    console.log('[debug] then parking the container for `docker exec -it <container> bash`.');

    applyEnvConfig();

    console.log('[debug] Config loaded from env:');
    console.log(`[debug]   REPO_URL        = ${CONFIG.REPO_URL || '(unset)'}`);
    console.log(`[debug]   REPO_BRANCH     = ${CONFIG.REPO_BRANCH || '(default)'}`);
    console.log(`[debug]   EXECUTION_MODEL = ${CONFIG.BACKEND_MODEL || '(unset)'}`);
    console.log(`[debug]   TEST_PLAN       = ${CONFIG.TEST_PLAN ? `${CONFIG.TEST_PLAN.slice(0, 80)}${CONFIG.TEST_PLAN.length > 80 ? '…' : ''}` : '(unset)'}`);
    console.log(`[debug]   BUILD_CMD       = ${CONFIG.BUILD_CMD || '(skipped)'}`);
    console.log(`[debug]   TEST_CMD        = ${CONFIG.TEST_CMD || '(skipped)'}`);
    console.log(`[debug]   JOB_TITLE       = ${CONFIG.JOB_TITLE || '(unset)'}`);

    const engine = new WorkflowEngine();
    const setup = await engine.runSetup();

    if (!setup.ok) {
        console.error(`[debug] setup failed at step "${setup.step}":`);
        console.error(setup.error);
        setTimeout(() => process.exit(1), 500);
        return;
    }

    console.log('[debug] Setup complete.');
    console.log(`[debug]   Repo path : ${CONFIG.REPO_PATH}`);
    console.log('[debug] Services up:');
    console.log(`[debug]   Display : ${CONFIG.DISPLAY} (${CONFIG.SCREEN_W}x${CONFIG.SCREEN_H}x24)`);
    console.log(`[debug]   VNC     : vnc://localhost:${CONFIG.PORT_VNC} (interactive, no password)`);
    console.log(`[debug]   MCP     : ${CONFIG.MCP_TRANSPORT} at http://${CONFIG.MCP_HOST}:${CONFIG.MCP_PORT}/`
        + (CONFIG.MCP_TRANSPORT === 'sse' ? 'sse' : 'mcp'));
    console.log(`[debug]   Docs    : http://${CONFIG.MCP_HOST}:${CONFIG.MCP_PORT}/docs`
        + ' (Swagger UI for all 16 controller tools)');
    console.log('[debug] Container is open for inspection.');
    console.log('[debug] Attach a shell with:   docker exec -it <container> bash');
    console.log('[debug] Connect a VNC client to vnc://localhost:<host-port> to drive the X display.');
    console.log('[debug] Teardown:               docker stop <container>      (or `docker compose stop`)');

    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`openvelo-tester-rewrite debug\nTESTER_DEBUG=true\nSetup complete; container is parked.\nRun \`docker exec -it <container> bash\` to inspect.\n`);
    });
    server.listen(CONFIG.TESTER_PORT, () => {
        console.log(`[debug] keepalive HTTP server listening on port ${CONFIG.TESTER_PORT}.`);
    });
    server.on('error', (err) => {
        console.error(`[debug] keepalive server error: ${err.message}`);
    });

    await waitForShutdown(server);

    setTimeout(() => process.exit(0), 500);
}

async function run() {
    try {
        if (isDebugMode()) {
            await runDebugMode();
            return;
        }

        await messenger.startServer();

        messenger.onHandshake(async () => {
            console.log('Handshake applied. Starting 3-stage workflow (Setup -> Test -> Verdict).');
            const engine = new WorkflowEngine();
            await engine.execute();
        });
    } catch (err: any) {
        console.error('Fatal error during startup:', err);
        process.exit(1);
    }
}

run();