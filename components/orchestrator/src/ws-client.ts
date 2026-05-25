import { WebSocket } from 'ws';
import { CONFIG } from './config.js';

type MessageHandler = (data: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const messageHandlers: MessageHandler[] = [];
let connectedProjectId: number | null = null;

export function onMessage(handler: MessageHandler): void {
    messageHandlers.push(handler);
}

export function send(message: Record<string, unknown>): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
}

export function getNextJobs(count: number): boolean {
    if (!connectedProjectId) return false;
    return send({ type: 'get_next_jobs', count, projectId: connectedProjectId });
}

export function connect(projectId: number): void {
    connectedProjectId = projectId;
    attemptConnect();
}

function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
    reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        attemptConnect();
    }, delay);
}

function attemptConnect(): void {
    const url = `${CONFIG.WEB_UI_URL}/api/orchestrator/ws?projectId=${connectedProjectId}`;
    console.log(`[WS] Connecting to web-ui at ${url}...`);

    const socket = new WebSocket(url);
    ws = socket;

    socket.on('open', () => {
        console.log('[WS] Connected to web-ui.');
        reconnectAttempts = 0;
        send({ type: 'hello', projectId: connectedProjectId });
    });

    socket.on('message', (raw: Buffer) => {
        try {
            const data = JSON.parse(raw.toString()) as Record<string, unknown>;
            for (const handler of messageHandlers) handler(data);
        } catch { /* ignore malformed */ }
    });

    socket.on('ping', () => socket.pong());

    socket.on('close', () => {
        console.warn('[WS] Connection to web-ui closed.');
        ws = null;
        scheduleReconnect();
    });

    socket.on('error', (err) => {
        console.error('[WS] Connection error:', (err as Error).message);
        socket.terminate();
    });
}
