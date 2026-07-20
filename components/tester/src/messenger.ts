import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, applyHandshake, type TesterHandshakeConfig } from './config.js';
import { AgentStatus } from './agent-status.js';

export class Messenger {
    private wss: WebSocketServer | null = null;
    private currentWs: WebSocket | null = null;
    private onHandshakeReady: (() => void) | null = null;
    private onCheckpointReady: (() => Promise<void>) | null = null;
    // Set once the terminal `finish` frame has been sent. After that, a
    // socket close initiated by the orchestrator is EXPECTED (it closes the
    // connection on receiving `finish`), so it must not be treated as a crash
    // or force a non-zero exit.
    private finishSent = false;

    constructor() { }

    public startServer(): Promise<void> {
        return new Promise((resolve) => {
            this.wss = new WebSocketServer({ port: CONFIG.TESTER_PORT });

            this.wss.on('connection', (ws: WebSocket) => {
                console.log('Orchestrator connected. Waiting for handshake...');
                this.currentWs = ws;
                AgentStatus.attach(ws);

                ws.on('message', (data: Buffer) => {
                    const payload = JSON.parse(data.toString()) as { type: string; config: TesterHandshakeConfig };
                    if (payload.type === 'handshake') {
                        console.log('Handshake received. Applying configuration.');
                        applyHandshake(payload.config);
                        if (this.onHandshakeReady) {
                            this.onHandshakeReady();
                        }
                    } else if (payload.type === 'checkpoint') {
                        console.log('Checkpoint signal received. Committing current work...');
                        if (this.onCheckpointReady) {
                            this.onCheckpointReady().catch((err) => {
                                console.error('Checkpoint commit failed:', err);
                                this.sendCheckpointDone();
                            });
                        } else {
                            this.sendCheckpointDone();
                        }
                    }
                });

                ws.on('close', () => {
                    this.currentWs = null;
                    if (this.finishSent) {
                        // Expected: orchestrator closed after receiving our
                        // terminal `finish`. Let the workflow's own exit path
                        // (with the correct code) run; do not force-kill here.
                        console.log('Orchestrator closed connection after finish. Tester shutting down.');
                        return;
                    }
                    console.log('Orchestrator disconnected before finish. Shutting down tester.');
                    process.exit(1);
                });
            });

            console.log(`Tester rewrite WebSocket server listening on port ${CONFIG.TESTER_PORT}`);
            resolve();
        });
    }

    public onHandshake(callback: () => void) {
        this.onHandshakeReady = callback;
    }

    public onCheckpoint(callback: () => Promise<void>) {
        this.onCheckpointReady = callback;
    }

    public sendCheckpointDone() {
        const payload = JSON.stringify({
            job_id: CONFIG.JOB_ID,
            type: 'checkpoint_done',
        });
        if (this.currentWs && this.currentWs.readyState === WebSocket.OPEN) {
            this.currentWs.send(payload);
        }
    }

    public log(message: string, type: 'info' | 'error' | 'status' | 'warn' | 'sse' | 'stdout' | 'stderr' = 'info') {
        const payload = JSON.stringify({
            job_id: CONFIG.JOB_ID,
            type,
            message,
            timestamp: new Date().toISOString()
        });

        if (this.currentWs && this.currentWs.readyState === WebSocket.OPEN) {
            try {
                this.currentWs.send(payload);
            } catch (err) {
                // Silent fail - log will still go to stdout/stderr via interceptor
            }
        }
    }

    public sendAgentStatus() {
        AgentStatus.sendAgentStatus();
    }

    /**
     * Send the terminal `finish` frame and RESOLVE ONLY AFTER it has been
     * flushed to the socket. The workflow awaits this before `process.exit`,
     * otherwise the process can tear the socket down before the frame leaves
     * the send buffer — the orchestrator then sees the connection drop with
     * no `finish` and (wrongly) treats the run as a crash, triggering a
     * retry. Resolves (never rejects) so shutdown always proceeds.
     */
    public sendFinish(status: 'success' | 'error', data: any = {}): Promise<void> {
        this.finishSent = true;
        const payload = JSON.stringify({
            job_id: CONFIG.JOB_ID,
            type: 'finish',
            status,
            ...data
        });

        return new Promise<void>((resolve) => {
            if (!this.currentWs || this.currentWs.readyState !== WebSocket.OPEN) {
                resolve();
                return;
            }
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            // Safety timeout so we never hang shutdown if the ack is lost.
            const timer = setTimeout(done, 2000);
            try {
                this.currentWs.send(payload, (err?: Error) => {
                    clearTimeout(timer);
                    if (err) {
                        console.error(`sendFinish flush error: ${err.message}`);
                    }
                    done();
                });
            } catch (err: any) {
                clearTimeout(timer);
                console.error(`sendFinish failed: ${err?.message ?? err}`);
                done();
            }
        });
    }
}

export const messenger = new Messenger();
