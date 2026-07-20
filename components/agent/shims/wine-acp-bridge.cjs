// Wine ACP transport bridge.
//
// Runs under the *Windows* Node (`node.exe`) inside Wine. It exists to work
// around a hard Wine limitation: Wine cannot expose a Unix pipe or socket as a
// Windows std handle, so `kilo.exe acp` (a Bun-compiled binary) crashes with
// `EBADF: bad file descriptor, open` the moment it tries to read stdin when the
// wrapper spawns it directly over pipes. A pseudo-terminal avoids the EBADF but
// makes kilo start its interactive TUI instead of speaking ACP, and echoes the
// JSON-RPC stream back at us.
//
// The reliable path is: let a Wine Node process spawn `kilo.exe` with
// `stdio: 'pipe'`. Those pipes are *native Win32* anonymous pipes, which kilo
// reads without EBADF. This bridge does exactly that and relays the ndjson
// JSON-RPC stream between kilo's stdio and a TCP socket back to the Linux
// wrapper (Winsock TCP works fine under Wine).
//
// Usage:
//   node wine-acp-bridge.cjs <port> <acpCwd> <kiloExe> [logFile]
//
// It NEVER touches its own process.stdin/stdout/stderr (those may be Unix
// handles that would EBADF); all diagnostics go to <logFile> via fs.

const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = parseInt(process.argv[2], 10);
const ACP_CWD = process.argv[3] || 'C:\\repo';
const KILO_EXE = process.argv[4];
const LOG_FILE = process.argv[5] || '';

function log(line) {
    if (!LOG_FILE) return;
    try {
        fs.appendFileSync(LOG_FILE, `[wine-acp-bridge] ${new Date().toISOString()} ${line}\n`);
    } catch (_e) {
        // logging is best-effort
    }
}

if (!Number.isInteger(PORT) || PORT <= 0) {
    log(`invalid port argument: ${process.argv[2]}`);
    process.exit(2);
}
if (!KILO_EXE) {
    log('missing kilo.exe path argument');
    process.exit(2);
}

log(`starting: port=${PORT} cwd=${ACP_CWD} kilo=${KILO_EXE}`);

const socket = net.connect(PORT, '127.0.0.1', () => {
    log('connected to wrapper');
    socket.setNoDelay(true);

    const child = spawn(KILO_EXE, ['acp', '--cwd', ACP_CWD], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', (err) => {
        log(`kilo spawn error: ${err.message}`);
        socket.destroy();
        process.exit(1);
    });

    child.on('exit', (code) => {
        log(`kilo exited with code ${code}`);
        socket.destroy();
        process.exit(0);
    });

    // kilo diagnostics -> log file only
    child.stderr.on('data', (d) => log(`[kilo stderr] ${d.toString().replace(/\s+$/, '')}`));

    // wrapper -> kilo stdin
    socket.on('data', (d) => {
        try {
            child.stdin.write(d);
        } catch (err) {
            log(`stdin write error: ${err.message}`);
        }
    });

    // kilo stdout -> wrapper
    child.stdout.on('data', (d) => {
        try {
            socket.write(d);
        } catch (err) {
            log(`socket write error: ${err.message}`);
        }
    });

    const shutdown = (reason) => {
        log(`shutting down: ${reason}`);
        try { child.kill(); } catch (_e) { /* ignore */ }
        process.exit(0);
    };
    socket.on('close', () => shutdown('socket closed'));
    socket.on('error', (err) => shutdown(`socket error: ${err.message}`));
});

socket.on('error', (err) => {
    log(`failed to connect to wrapper: ${err.message}`);
    process.exit(1);
});
