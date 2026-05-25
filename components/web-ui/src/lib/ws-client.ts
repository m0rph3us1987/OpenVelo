type MessageCallback = (data: unknown) => void;
type VoidCallback = () => void;

interface WsClientOptions {
    onMessage?: MessageCallback;
    onConnect?: VoidCallback;
    onDisconnect?: VoidCallback;
    onError?: (err: Event) => void;
    reconnectAttempts?: number;
    reconnectDelayMs?: number;
}

export class WsClient {
    private ws: WebSocket | null = null;
    private chatId: number | null = null;
    private url: string;
    private opts: Required<WsClientOptions>;
    private reconnectCount = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private intentionallyClosed = false;

    constructor(baseUrl: string, opts: WsClientOptions = {}) {
        this.url = baseUrl.replace(/^http/, 'ws');
        this.opts = {
            onMessage: opts.onMessage ?? (() => {}),
            onConnect: opts.onConnect ?? (() => {}),
            onDisconnect: opts.onDisconnect ?? (() => {}),
            onError: opts.onError ?? (() => {}),
            reconnectAttempts: opts.reconnectAttempts ?? 5,
            reconnectDelayMs: opts.reconnectDelayMs ?? 1000,
        };
    }

    connect(chatId: number): void {
        if (this.chatId === chatId && this.ws?.readyState === WebSocket.OPEN) {
            return;
        }
        this.chatId = chatId;
        this.intentionallyClosed = false;
        this.reconnectCount = 0;
        this.doConnect();
    }

    private doConnect(): void {
        if (!this.chatId) return;

        const wsUrl = `${this.url}/ws?chatId=${this.chatId}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.reconnectCount = 0;
            this.opts.onConnect();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.opts.onMessage(data);
            } catch { /* ignore parse errors */ }
        };

        this.ws.onclose = () => {
            this.opts.onDisconnect();
            if (!this.intentionallyClosed) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (err) => {
            this.opts.onError(err);
        };
    }

    private scheduleReconnect(): void {
        if (this.reconnectCount >= this.opts.reconnectAttempts) {
            return;
        }
        const delay = this.opts.reconnectDelayMs * Math.pow(2, this.reconnectCount);
        this.reconnectCount++;
        this.reconnectTimer = setTimeout(() => {
            this.doConnect();
        }, delay);
    }

    disconnect(): void {
        this.intentionallyClosed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.chatId = null;
    }

    send(data: Record<string, unknown>): void {
        if (this.ws && (this.ws.readyState as number) === 1) {
            this.ws.send(JSON.stringify(data));
        }
    }
}

let clientInstance: WsClient | null = null;

export function getWsClient(): WsClient | null {
    return clientInstance;
}

export function createWsClient(baseUrl: string, opts?: WsClientOptions): WsClient {
    if (clientInstance) {
        clientInstance.disconnect();
    }
    clientInstance = new WsClient(baseUrl, opts);
    return clientInstance;
}