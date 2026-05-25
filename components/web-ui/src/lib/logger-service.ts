import { wsManager, WsKeys } from './websocket-manager';

type LogSubscriber = (line: string) => void;

type CallbackSet = Set<LogSubscriber>;

class LoggerService {
    private subscribers = new Map<number, CallbackSet>();
    private rawSseSubscribers = new Map<number, CallbackSet>();

    clearChat(chatId: number): void {
        this.subscribers.delete(chatId);
        this.rawSseSubscribers.delete(chatId);
    }

    subscribe(chatId: number, callback: LogSubscriber): () => void {
        let subs = this.subscribers.get(chatId);
        if (!subs) {
            subs = new Set();
            this.subscribers.set(chatId, subs);
        }
        subs.add(callback);
        return () => {
            subs?.delete(callback);
        };
    }

    append(chatId: number, line: string): void {
        const subs = this.subscribers.get(chatId);
        if (subs) {
            for (const cb of subs) {
                try {
                    cb(line);
                } catch { /* ignore callback errors */ }
            }
        }
        wsManager.broadcast(WsKeys.chatKey(chatId), { line });
    }

    appendVerbose(chatId: number, prefix: string, message: string): void {
        const formatted = `[${prefix}] ${message}`;
        console.log(formatted);
        this.append(chatId, formatted + '\n');
    }

    subscribeRawSse(chatId: number, callback: LogSubscriber): () => void {
        let subs = this.rawSseSubscribers.get(chatId);
        if (!subs) {
            subs = new Set();
            this.rawSseSubscribers.set(chatId, subs);
        }
        subs.add(callback);
        return () => {
            subs?.delete(callback);
        };
    }

    appendRawSse(chatId: number, block: string): void {
        const subs = this.rawSseSubscribers.get(chatId);
        if (subs) {
            for (const cb of subs) {
                try {
                    cb(block);
                } catch { /* ignore callback errors */ }
            }
        }
        wsManager.broadcast(WsKeys.chatKey(chatId), { rawSse: block });
    }
}

export const loggerService = new LoggerService();