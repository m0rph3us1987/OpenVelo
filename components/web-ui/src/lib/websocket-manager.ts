type WsLike = {
    on(event: string, handler: (...args: unknown[]) => void): void;
    send(payload: string): void;
    close(): void;
    readyState: number;
};

type ClientKey = string;

class WebSocketManager {
    private clients = new Map<ClientKey, Set<WsLike>>();
    private keyByWs = new WeakMap<WsLike, ClientKey>();

    /** Build a namespaced key to avoid chatId/projectId collisions. */
    static chatKey(chatId: string | number): ClientKey {
        return `chat:${chatId}`;
    }
    static projectKey(projectId: string | number): ClientKey {
        return `project:${projectId}`;
    }
    static jobKey(jobId: string | number): ClientKey {
        return `job:${jobId}`;
    }

    register(key: ClientKey, ws: WsLike): void {
        if (!this.clients.has(key)) {
            this.clients.set(key, new Set());
        } else {
            for (const existingWs of this.clients.get(key)!) {
                this.keyByWs.delete(existingWs);
                try { existingWs.close(); } catch { /* ignore */ }
            }
            this.clients.get(key)!.clear();
        }
        this.clients.get(key)!.add(ws);
        this.keyByWs.set(ws, key);

        ws.on('close', () => {
            this.unregister(ws);
        });

        ws.on('error', (err: unknown) => {
            console.error(`[WS] Error for key=${key}:`, (err as Error)?.message);
            this.unregister(ws);
        });
    }

    unregister(ws: WsLike): void {
        const key = this.keyByWs.get(ws);
        if (key === undefined) return;
        this.keyByWs.delete(ws);

        const set = this.clients.get(key);
        if (set) {
            set.delete(ws);
            if (set.size === 0) {
                this.clients.delete(key);
            }
        }
    }

    broadcast(key: ClientKey, message: Record<string, unknown>): void {
        const set = this.clients.get(key);
        if (!set || set.size === 0) return;
        const payload = JSON.stringify(message);
        for (const ws of set) {
            if (ws.readyState === 1) {
                try {
                    ws.send(payload);
                } catch (err) {
                    console.error(`[WS] send() failed for key=${key}:`, (err as Error)?.message);
                    this.unregister(ws);
                }
            }
        }
    }

    getClientCount(key: ClientKey): number {
        return this.clients.get(key)?.size ?? 0;
    }

    broadcastToProject(projectId: string | number, event: Record<string, unknown>): void {
        const key = WebSocketManager.projectKey(projectId);
        console.log(`[WS] broadcasting to project ${projectId}:`, JSON.stringify(event));
        this.broadcast(key, event);
    }
}

export const wsManager = new WebSocketManager();
export const WsKeys = WebSocketManager;
