import { spawn } from 'child_process';
import { CONFIG } from './config.js';

const IS_WINDOWS = process.platform === 'win32';

const WATCH_PATTERNS = [
    /\b--watch\b/,
    /\b--watchAll\b/,
    /\s-w\b/,
];

export function isWatchMode(command: string): boolean {
    return WATCH_PATTERNS.some(pattern => pattern.test(command));
}

function quoteArg(arg: string): string {
    if (IS_WINDOWS) {
        // cmd.exe: wrap in double quotes, escape inner double quotes
        return `"${arg.replace(/"/g, '\\"')}"`;
    }
    // bash: wrap in single quotes, escape inner single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

export async function runCommand(
    command: string, 
    args: string[], 
    cwd: string = CONFIG.REPO_PATH
): Promise<{ code: number | null, output: string }> {
    return new Promise((resolve) => {
        const fullCommand = args.length > 0 
            ? `${command} ${args.map(quoteArg).join(' ')}` 
            : command;

        console.log(`Running: ${fullCommand}`);
        
        const child = spawn(fullCommand, [], { 
            cwd, 
            shell: IS_WINDOWS ? 'cmd.exe' : '/bin/bash', 
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { 
                ...process.env, 
                TERM: 'xterm',
                FORCE_COLOR: '1',
                ...(IS_WINDOWS ? {} : { PYTHONUNBUFFERED: '1' })
            }
        });

        let output = '';

        child.stdout?.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stdout.write(str);
        });

        child.stderr?.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stderr.write(str);
        });

        child.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.error(`Command exited with code ${code}`);
            }
            resolve({ code, output });
        });

        child.on('error', (err) => {
            console.error(`Failed to start process: ${err.message}`);
            resolve({ code: 1, output: err.message });
        });
    });
}

/**
 * Spawn a command using the shell for PATH resolution but passing arguments
 * via argv.  This avoids the newline-in-quoted-string issue that breaks
 * cmd.exe when the entire command is a single concatenated string, while
 * still letting the shell locate executables on PATH.
 * Use this for AI CLI invocations where prompts are large multi-line strings.
 */
export async function runCommandDirect(
    command: string,
    args: string[],
    cwd: string = CONFIG.REPO_PATH
): Promise<{ code: number | null, output: string }> {
    return new Promise((resolve) => {
        const preview = args.map(a => a.length > 80 ? a.substring(0, 80) + '…' : a).join(' ');
        console.log(`Running (direct): ${command} ${preview}`);

        const child = spawn(command, args, {
            cwd,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                TERM: 'xterm',
                FORCE_COLOR: '1',
                ...(IS_WINDOWS ? {} : { PYTHONUNBUFFERED: '1' })
            }
        });

        let output = '';

        child.stdout?.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stdout.write(str);
        });

        child.stderr?.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stderr.write(str);
        });

        child.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.error(`Command exited with code ${code}`);
            }
            resolve({ code, output });
        });

        child.on('error', (err) => {
            console.error(`Failed to start process: ${err.message}`);
            resolve({ code: 1, output: err.message });
        });
    });
}
