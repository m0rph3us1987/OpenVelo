import { WebSocket } from 'ws';
import { CONFIG } from './config.js';
import type { PlanEntry, Usage, UsageUpdate } from './acp-schema.js';

export type Stage =
    | 'setup'
    | 'blueprinting'
    | 'implementing'
    | 'testing'
    | 'reviewing'
    | 'documenting'
    | 'pushing';

class AgentStatusImpl {
    private _stage: Stage | null = null;
    private _attempt: number | null = null;
    private _maxRetries: number | null = null;
    private _planEntries: PlanEntry[] = [];
    private _planDirty: boolean = false;
    private _usage: Usage | null = null;
    private _usageUpdate: UsageUpdate | null = null;
    private _usageDirty: boolean = false;
    private _contextDirty: boolean = false;
    private ws: WebSocket | null = null;

    public attach(ws: WebSocket): void {
        this.ws = ws;
    }

    public get stage(): Stage | null {
        return this._stage;
    }

    public set stage(v: Stage) {
        if (this._stage === v) return;
        this._stage = v;
        this.sendAgentStatus();
    }

    public get attempt(): number | null {
        return this._attempt;
    }

    public set attempt(v: number) {
        if (this._attempt === v) return;
        this._attempt = v;
        this.sendAgentStatus();
    }

    public get maxRetries(): number | null {
        return this._maxRetries;
    }

    public set maxRetries(v: number) {
        if (this._maxRetries === v) return;
        this._maxRetries = v;
        this.sendAgentStatus();
    }

    public get planEntries(): PlanEntry[] {
        return this._planEntries;
    }

    public setPlanEntries(entries: PlanEntry[]): void {
        const changed =
            this._planEntries.length !== entries.length ||
            this._planEntries.some((e, i) => {
                const n = entries[i];
                return !n || e.content !== n.content || e.status !== n.status || e.priority !== n.priority;
            });
        if (!changed) return;
        this._planEntries = entries;
        this._planDirty = true;
        this.sendAgentStatus();
    }

    public clearPlan(): void {
        if (this._planEntries.length === 0 && !this._planDirty) return;
        this._planEntries = [];
        this._planDirty = true;
        this.sendAgentStatus();
    }

    public get usage(): Usage | null {
        return this._usage;
    }

    public clearUsage(): void {
        if (this._usage === null && !this._usageDirty) return;
        this._usage = null;
        this._usageDirty = false;
    }

    /**
     * Accumulate a per-turn `usage` delta from the Kilo ACP into the
     * stored cumulative snapshot.
     *
     * Note on granularity: the Kilo ACP `session/prompt` response only
     * carries the *last* assistant message's tokens for the turn, not the
     * sum across all intermediate assistant messages. So within a single
     * OpenVelo `sendPrompt` call, these totals reflect only the final
     * message; across calls (setup → blueprint → implement → ...) they
     * accumulate. The Kilo CLI's TUI shows a running sum across all
     * intermediate messages because it has direct SDK access; the agent
     * speaking only JSON-RPC over ACP cannot. The `cost` field (delivered
     * separately via `usage_update`) IS cumulative on the agent side.
     *
     * Note on input semantic: Kilo's `usage.inputTokens` is the
     * uncached-only portion of input (Kilo's `tokens.input` in
     * `session.ts:392` is already `raw − cache.read − cache.write`).
     * The Kilo CLI's "Context" display sums
     * `input + output + reasoning + cache.read + cache.write` of the last
     * assistant message — i.e. it folds cache.read/write into "input" and
     * reasoning into "output". Match that semantic so the web-UI's
     * "Input" / "Output" lines are in the same magnitude as the CLI.
     */
    public setUsage(usage: Usage): void {
        const a = this._usage ?? {};
        // Kilo's `usage.inputTokens` is the uncached-only portion of input
        // (Kilo's `tokens.input` in session.ts:392 is already
        // `raw − cache.read − cache.write`). The Kilo CLI's "Context" display
        // (cli/cmd/tui/component/prompt/index.tsx:340-357) sums
        // `input + output + reasoning + cache.read + cache.write` of the last
        // assistant message — i.e. it folds cache.read/write into "input" and
        // reasoning into "output". Match that semantic so the web-UI's
        // "Input" / "Output" lines are in the same magnitude as the CLI.
        const deltaInputFull =
            (usage.inputTokens ?? 0) +
            (usage.cachedReadTokens ?? 0) +
            (usage.cachedWriteTokens ?? 0);
        const deltaOutputFull = (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0);

        const nextInput = (a.inputTokens ?? 0) + deltaInputFull;
        const nextOutput = (a.outputTokens ?? 0) + deltaOutputFull;
        const nextCachedRead = (a.cachedReadTokens ?? 0) + (usage.cachedReadTokens ?? 0);
        const nextCachedWrite = (a.cachedWriteTokens ?? 0) + (usage.cachedWriteTokens ?? 0);
        const nextTotal = nextInput + nextOutput + nextCachedRead + nextCachedWrite;
        const same =
            (a.inputTokens ?? 0) === nextInput &&
            (a.outputTokens ?? 0) === nextOutput &&
            (a.cachedReadTokens ?? 0) === nextCachedRead &&
            (a.cachedWriteTokens ?? 0) === nextCachedWrite;
        if (same) return;
        const next: Usage = { totalTokens: nextTotal };
        if (nextInput) next.inputTokens = nextInput;
        if (nextOutput) next.outputTokens = nextOutput;
        if (nextCachedRead) next.cachedReadTokens = nextCachedRead;
        if (nextCachedWrite) next.cachedWriteTokens = nextCachedWrite;
        this._usage = next;
        this._usageDirty = true;
        this.sendAgentStatus();
    }

    public get contextUpdate(): UsageUpdate | null {
        return this._usageUpdate;
    }

    public setContextUpdate(u: UsageUpdate): void {
        const a = this._usageUpdate;
        const same =
            a !== null &&
            a.used === u.used &&
            a.size === u.size &&
            a.cost?.amount === u.cost?.amount &&
            a.cost?.currency === u.cost?.currency;
        if (same) return;
        this._usageUpdate = u;
        this._contextDirty = true;
        this.sendAgentStatus();
    }

    public set(stage: Stage, attempt?: number, maxRetries?: number): void {
        const changed =
            this._stage !== stage ||
            (attempt !== undefined && this._attempt !== attempt) ||
            (maxRetries !== undefined && this._maxRetries !== maxRetries);

        if (attempt !== undefined) this._attempt = attempt;
        if (maxRetries !== undefined) this._maxRetries = maxRetries;
        this._stage = stage;

        if (changed) this.sendAgentStatus();
    }

    public sendAgentStatus(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = JSON.stringify({
            job_id: CONFIG.JOB_ID,
            type: 'stage',
            stage: this._stage,
            attempt: this._attempt ?? undefined,
            max_retries: this._maxRetries ?? undefined,
            timestamp: new Date().toISOString(),
        });

        this.ws.send(payload);

        if (this._planDirty) {
            const planPayload = JSON.stringify({
                job_id: CONFIG.JOB_ID,
                type: 'plan',
                entries: this._planEntries,
                timestamp: new Date().toISOString(),
            });
            this.ws.send(planPayload);
        }

        if (this._usageDirty && this._usage) {
            const usagePayload = JSON.stringify({
                job_id: CONFIG.JOB_ID,
                type: 'usage',
                usage: this._usage,
                timestamp: new Date().toISOString(),
            });
            this.ws.send(usagePayload);
        }

        if (this._contextDirty && this._usageUpdate) {
            const contextPayload = JSON.stringify({
                job_id: CONFIG.JOB_ID,
                type: 'context',
                used: this._usageUpdate.used,
                size: this._usageUpdate.size,
                cost: this._usageUpdate.cost,
                timestamp: new Date().toISOString(),
            });
            this.ws.send(contextPayload);
        }
    }
}

export const AgentStatus = new AgentStatusImpl();
