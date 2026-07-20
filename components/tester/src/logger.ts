type LogSubscriber = (line: string) => void;

type CallbackSet = Set<LogSubscriber>;

class AgentLoggerService {
    private subscribers = new Map<number, CallbackSet>();
    private defaultSubscribers: CallbackSet = new Set();

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

    subscribeDefault(callback: LogSubscriber): () => void {
        this.defaultSubscribers.add(callback);
        return () => {
            this.defaultSubscribers.delete(callback);
        };
    }

    append(chatId: number, line: string): void {
        const subs = this.subscribers.get(chatId);
        if (subs) {
            for (const cb of subs) {
                try { cb(line); } catch { /* ignore */ }
            }
        }
        for (const cb of this.defaultSubscribers) {
            try { cb(line); } catch { /* ignore */ }
        }
    }

    log(line: string): void {
        console.log(line);
        for (const cb of this.defaultSubscribers) {
            try { cb(line); } catch { /* ignore */ }
        }
    }

    error(line: string): void {
        console.error(line);
        for (const cb of this.defaultSubscribers) {
            try { cb(line); } catch { /* ignore */ }
        }
    }
}

export const agentLogger = new AgentLoggerService();