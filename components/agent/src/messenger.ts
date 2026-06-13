import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, applyHandshake, type HandshakeConfig } from './config.js';
import { AgentStatus } from './agent-status.js';

export class Messenger {
    private wss: WebSocketServer | null = null;
    private currentWs: WebSocket | null = null;
    private onHandshakeReady: (() => void) | null = null;
    private onCheckpointReady: (() => Promise<void>) | null = null;

    constructor() { }

    public startServer(): Promise<void> {
        return new Promise((resolve) => {
            this.wss = new WebSocketServer({ port: CONFIG.AGENT_PORT });
            
            this.wss.on('connection', (ws: WebSocket) => {
                console.log('Orchestrator connected. Waiting for handshake...');
                this.currentWs = ws;
                AgentStatus.attach(ws);
                
                ws.on('message', (data: Buffer) => {
                    const payload = JSON.parse(data.toString()) as { type: string; config: HandshakeConfig };
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
                    console.log('Orchestrator disconnected. Shutting down agent.');
                    this.currentWs = null;
                    process.exit(1);
                });
            });

            console.log(`Agent WebSocket server listening on port ${CONFIG.AGENT_PORT}`);
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

    public sendFinish(status: 'success' | 'error', data: any = {}) {
        const payload = JSON.stringify({
            job_id: CONFIG.JOB_ID,
            type: 'finish',
            status,
            ...data
        });

        if (this.currentWs && this.currentWs.readyState === WebSocket.OPEN) {
            this.currentWs.send(payload);
        }
    }
}

export const messenger = new Messenger();
