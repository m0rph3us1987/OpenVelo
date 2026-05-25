import { messenger } from './messenger.js';
import { WorkflowEngine } from './workflow.js';
import { CONFIG } from './config.js';

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

console.log('--- OpenVelo Agent Startup (Server Mode) ---');
console.log(`Listening on port: ${CONFIG.AGENT_PORT}`);
console.log(`Job ID: ${CONFIG.JOB_ID}`);

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

async function run() {
    try {
        await messenger.startServer();
        
        messenger.onHandshake(async () => {
            console.log('Handshake applied. Configuration received. Starting workflow.');
            const engine = new WorkflowEngine();
            await engine.execute();
        });
    } catch (err: any) {
        console.error('Fatal error during startup:', err);
        process.exit(1);
    }
}

run();
