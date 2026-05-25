import { openCodeServerManager, type MessageResult } from './opencode-server.js';

export class AgentSession {
    private id: string;
    private name: string;
    private _created: boolean = false;

    constructor(name: string) {
        this.name = name;
        this.id = '';
    }

    async ensureCreated(): Promise<void> {
        if (this._created) return;
        this.id = await openCodeServerManager.createSession();
        this._created = true;
    }

    get sessionId(): string {
        return this.id;
    }

    async send(prompt: string, model?: string): Promise<MessageResult> {
        await this.ensureCreated();
        return openCodeServerManager.sendMessage(this.id, prompt, model);
    }

    async fix(errors: string, model?: string): Promise<MessageResult> {
        const fixPrompt = `Fix these errors:\n\n${errors}\n\nFix all remaining errors. Do not revert any previously applied fix.`;
        return this.send(fixPrompt, model);
    }
}