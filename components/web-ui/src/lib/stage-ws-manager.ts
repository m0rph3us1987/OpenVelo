type WsLike = {
    on(event: string, handler: (...args: unknown[]) => void): void;
    send(payload: string): void;
    readyState: number;
};

type StageClientKey = string;

class StageWebSocketManager {
    private clients = new Map<StageClientKey, Set<WsLike>>();
    private keyByWs = new WeakMap<WsLike, StageClientKey>();

    static stageKey(chatId: string | number, stage: string): StageClientKey {
        return `stage:${chatId}:${stage}`;
    }

    register(key: StageClientKey, ws: WsLike): void {
        if (!this.clients.has(key)) {
            this.clients.set(key, new Set());
        }
        this.clients.get(key)!.add(ws);
        this.keyByWs.set(ws, key);

        ws.on('close', () => {
            this.unregister(ws);
        });

        ws.on('error', (err: unknown) => {
            console.error(`[StageWS] Error for key=${key}:`, (err as Error)?.message);
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

    broadcast(key: StageClientKey, message: Record<string, unknown>): void {
        const set = this.clients.get(key);
        if (!set || set.size === 0) return;
        const payload = JSON.stringify(message);
        for (const ws of set) {
            if (ws.readyState === 1) {
                try {
                    ws.send(payload);
                } catch (err) {
                    console.error(`[StageWS] send() failed for key=${key}:`, (err as Error)?.message);
                    this.unregister(ws);
                }
            }
        }
    }

    broadcastToStage(chatId: string | number, stage: string, event: Record<string, unknown>): void {
        const key = StageWebSocketManager.stageKey(chatId, stage);
        console.log(`[StageWS] broadcasting to stage ${chatId}/${stage}:`, JSON.stringify(event));
        this.broadcast(key, event);
    }

    closeStageWs(chatId: string | number, stage: string): void {
        const key = StageWebSocketManager.stageKey(chatId, stage);
        const set = this.clients.get(key);
        if (set) {
            for (const ws of set) {
                try {
                    ws.send(JSON.stringify({ type: 'closed' }));
                    ws.on('close', () => {});
                } catch {
                    // ignore
                }
            }
            this.clients.delete(key);
        }
    }
}

export const stageWsManager = new StageWebSocketManager();
export const StageWsKeys = StageWebSocketManager;