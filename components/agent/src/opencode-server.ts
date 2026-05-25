import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { CONFIG } from './config.js';

interface SessionInfo {
    id: string;
    [key: string]: unknown;
}

export interface MessageResult {
    info: { id: string; [key: string]: unknown };
    parts: unknown[];
}

function httpPost(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const parsed = new URL(url);
        const options: http.RequestOptions = {
            hostname: parsed.hostname,
            port: parseInt(parsed.port, 10),
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        const req = http.request(options, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
            });
        });
        req.on('error', (err) => {
            reject(err);
        });
        req.write(payload);
        req.end();
    });
}

export class OpenCodeServerManager {
    private serverProcess: ChildProcess | null = null;
    private port = 0;
    private baseUrl = '';
    private startPromise: Promise<void> | null = null;
    private sseRequest: http.ClientRequest | null = null;
    private sseBuf = '';
    private loggedToolCalls = new Set<string>();

    async ensureStarted(repoPath: string, model?: string): Promise<void> {
        if (this.startPromise) return this.startPromise;
        this.startPromise = this._start(repoPath, model);
        return this.startPromise;
    }

    private async _start(repoPath: string, model?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = ['serve', '--port', '0'];

            const env: Record<string, string> = {
                ...process.env as Record<string, string>,
                OPENCODE_YOLO: '1',
            };
            env['PATH'] = `/usr/local/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:${env['PATH'] || ''}`;

            process.stdout.write(`[opencode-server] Starting opencode serve with model: ${model ?? 'default'}\n`);

            let proc: ReturnType<typeof spawn> | null = null;
            try {
                proc = spawn('opencode', args, {
                    cwd: repoPath,
                    env,
                    shell: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch (err) {
                process.stderr.write(`[opencode-server] spawn failed: ${err}\n`);
                reject(new Error(`Failed to spawn opencode: ${err}`));
                return;
            }

            this.serverProcess = proc;

            const timeout = setTimeout(() => {
                if (proc) proc.kill();
                reject(new Error('opencode serve did not report its port within 15 s'));
            }, 15_000);

            const tryParseLine = (line: string) => {
                const m = line.match(/listening on http:\/\/(127\.0\.0\.1|localhost):(\d+)/i);
                if (m && m[2]) {
                    clearTimeout(timeout);
                    this.port = parseInt(m[2], 10);
                    this.baseUrl = `http://127.0.0.1:${this.port}`;
                    process.stdout.write(`[opencode-server] ready on port ${this.port}\n`);
                    void this._connectSse();
                    resolve();
                }
            };

            let stdoutBuf = '';
            proc.stdout?.on('data', (chunk: Buffer) => {
                stdoutBuf += chunk.toString();
                const lines = stdoutBuf.split('\n');
                stdoutBuf = lines.pop() ?? '';
                for (const l of lines) tryParseLine(l);
            });

            let stderrBuf = '';
            proc.stderr?.on('data', (chunk: Buffer) => {
                stderrBuf += chunk.toString();
                const lines = stderrBuf.split('\n');
                stderrBuf = lines.pop() ?? '';
                for (const l of lines) {
                    tryParseLine(l);
                    process.stderr.write(`[opencode stderr] ${l}\n`);
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                process.stderr.write(`[opencode-server] error: ${err}\n`);
                reject(err);
            });

            proc.on('exit', (code) => {
                clearTimeout(timeout);
                process.stdout.write(`[opencode-server] exited (code ${code})\n`);
                this.serverProcess = null;
                this.startPromise = null;
                this._disconnectSse();
                if (code !== 0 && code !== null) {
                    reject(new Error(`opencode serve exited with code ${code}`));
                }
            });
        });
    }

    shutdown(): void {
        this._disconnectSse();
        if (this.serverProcess) {
            try { this.serverProcess.kill(); } catch { /* ignore */ }
            this.serverProcess = null;
        }
        this.startPromise = null;
        this.port = 0;
        this.baseUrl = '';
    }

    get isRunning(): boolean {
        return this.serverProcess !== null && this.port > 0;
    }

    private _connectSse(): void {
        if (!this.baseUrl) return;
        this._disconnectSse();

        const parsed = new URL(`${this.baseUrl}/event`);
        const options: http.RequestOptions = {
            hostname: parsed.hostname,
            port: parseInt(parsed.port, 10),
            path: parsed.pathname,
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
        };

        const req = http.request(options, (res) => {
            let buf = '';
            res.on('data', (chunk: Buffer) => {
                buf += chunk.toString();
                const blocks = buf.split('\n\n');
                buf = blocks.pop() ?? '';
                for (const block of blocks) {
                    this._handleSseBlock(block);
                }
            });
            res.on('end', () => {
                setTimeout(() => {
                    if (this.isRunning) void this._connectSse();
                }, 2_000);
            });
        });

        req.on('error', () => {
            setTimeout(() => {
                if (this.isRunning) void this._connectSse();
            }, 2_000);
        });

        req.end();
        this.sseRequest = req;
    }

    private _disconnectSse(): void {
        if (this.sseRequest) {
            try { this.sseRequest.destroy(); } catch { /* ignore */ }
            this.sseRequest = null;
        }
    }

    private _handleSseBlock(block: string): void {
        const lines = block.split('\n');
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (!dataLine) return;

        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
        } catch {
            return;
        }

        const eventType = payload['type'] as string | undefined;
        const properties = payload['properties'] as Record<string, unknown> | undefined;
        if (!eventType || !properties) return;
        
        if (eventType === 'message.part.updated') {
            const part = properties?.['part'] as Record<string, unknown> | undefined;
            if (part?.['type'] === 'tool') {
                const toolName = part['tool'] ?? 'unknown';
                const state = part['state'] as Record<string, unknown> | undefined;
                const callID = part['callID'] as string | undefined;

                if (state?.['status'] === 'running') {
                    if (callID && !this.loggedToolCalls.has(callID)) {
                        this.loggedToolCalls.add(callID);
                        const input = state['input'] as Record<string, unknown> | undefined;
                        process.stdout.write('\n' + this.formatToolLog(String(toolName), input) + '\n');
                    }
                } else if (callID && this.loggedToolCalls.has(callID)) {
                    this.loggedToolCalls.delete(callID);
                }
            }
            // text/reasoning streamed via message.part.delta - skip to avoid duplicates
            return;
        }

        if (eventType === 'message.part.delta') {
            const delta = properties?.['delta'] as string | undefined;
            if (delta) {
                process.stdout.write(delta);
            }
            return;
        }

        if (eventType === 'message.done') {
            process.stdout.write('[message.done]\n');
            return;
        }

        if (eventType === 'session.idle') {
            return;
        }

        if (eventType === 'permission.asked') {
            const permissionID = properties['id'] as string | undefined;
            const sessionID = properties['sessionID'] as string | undefined;
            if (permissionID && sessionID) {
                process.stdout.write(`[permission.asked] auto-granting ${permissionID}\n`);
                void httpPost(`${this.baseUrl}/session/${sessionID}/permissions/${permissionID}`, { response: 'grant', remember: true });
            }
            return;
        }
    }

    async createSession(): Promise<string> {
        process.stdout.write(`[createSession] POST ${this.baseUrl}/session\n`);
        const result = await httpPost(`${this.baseUrl}/session`, {});
        process.stdout.write(`[createSession] Response status=${result.status}\n`);
        if (result.status >= 400) {
            throw new Error(`createSession HTTP ${result.status}: ${JSON.stringify(result.data)}`);
        }
        const data = result.data as SessionInfo;
        if (!data?.id) throw new Error(`createSession: unexpected response: ${JSON.stringify(data)}`);
        return data.id;
    }

    async sendMessage(sessionId: string, text: string, model?: string): Promise<MessageResult> {
        const [providerID, modelID] = model?.includes('/') ? model.split('/', 2) : [undefined, undefined];
        const modelObj = providerID && modelID ? { providerID, modelID } : undefined;

        process.stdout.write(`[sendMessage] Session ${sessionId}, model=${JSON.stringify(modelObj)}\n`);
        process.stdout.write(`[sendMessage] --- BEGIN PROMPT ---\n`);
        for (const line of text.split('\n')) {
            process.stdout.write(`${line}\n`);
        }
        process.stdout.write(`[sendMessage] --- END PROMPT ---\n`);

        const body: Record<string, unknown> = {
            role: 'user',
            parts: [{ type: 'text', text }],
            model: modelObj,
        };

        const result = await httpPost(`${this.baseUrl}/session/${sessionId}/message`, body);
        if (result.status >= 400) {
            throw new Error(`sendMessage HTTP ${result.status}: ${JSON.stringify(result.data)}`);
        }
        return result.data as MessageResult;
    }

    async abortSession(sessionId: string): Promise<void> {
        try {
            await httpPost(`${this.baseUrl}/session/${sessionId}/abort`, {});
        } catch { /* ignore */ }
    }

    private formatToolLog(toolName: string, input?: Record<string, unknown>): string {
        switch (toolName) {
            case 'read':
                return `[READING] ${input?.['filePath'] ?? 'unknown'}`;

            case 'bash': {
                const description = input?.['description'] as string | undefined;
                const command = input?.['command'] as string | undefined;
                return `[BASH] ${description ?? ''}\n  - ${command ?? ''}`;
            }

            case 'glob':
                return `[GLOB] ${input?.['pattern'] ?? ''}`;

            case 'todowrite':
                return this.formatTodosLog(input);

            case 'write':
                return `[WRITING] ${input?.['filePath'] ?? 'unknown'}`;

            case 'grep': {
                const pattern = input?.['pattern'] as string | undefined;
                const path = input?.['path'] as string | undefined;
                return `[GREP] "${pattern ?? ''}" in ${path ?? '.'}`;
            }

            case 'edit':
                return `[EDIT] ${input?.['filePath'] ?? 'unknown'}`;

            default:
                return `[TOOL] ${toolName}: ${JSON.stringify(input ?? {})}`;
        }
    }

    private formatTodosLog(input?: Record<string, unknown>): string {
        const todos = input?.['todos'] as Array<{ content?: string; status?: string } | undefined>;
        if (!todos || !Array.isArray(todos)) return '[TODOS]';

        const lines: string[] = ['[TODOS]:'];
        for (const todo of todos) {
            if (!todo) continue;
            const status = (todo.status ?? 'pending').toUpperCase();
            const check = status === 'COMPLETED' ? '✓' : '○';
            lines.push(`  [${check}] ${todo.content ?? ''}`);
        }
        return lines.join('\n');
    }
}

export const openCodeServerManager = new OpenCodeServerManager();
