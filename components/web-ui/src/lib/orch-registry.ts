import type { WebSocket } from 'ws';

// Active orchestrator WS connections, keyed by projectId
const registry = new Map<number, WebSocket>();

export function registerOrchestrator(projectId: number, ws: WebSocket): void {
    registry.set(projectId, ws);
}

export function getOrchestrator(projectId: number): WebSocket | undefined {
    return registry.get(projectId);
}

export function removeOrchestrator(projectId: number): void {
    registry.delete(projectId);
}

export function isOrchestratorConnected(projectId: number): boolean {
    const ws = registry.get(projectId);
    return !!ws && (ws.readyState as number) === 1 /* OPEN */;
}

/** Returns true if the message was sent successfully. */
export function sendToOrchestrator(projectId: number, message: Record<string, unknown>): boolean {
    const ws = registry.get(projectId);
    if (!ws || (ws.readyState as number) !== 1 /* OPEN */) return false;
    ws.send(JSON.stringify(message));
    return true;
}

