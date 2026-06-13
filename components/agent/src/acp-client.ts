// ACPClient — clean, dedicated client for the `kilo acp` subprocess.
//
// Owns the `kilo acp` child process, speaks JSON-RPC 2.0 over stdio,
// and exposes a small typed API for the workflow:
//
//   const client = await ACPClient.init({ cwd: '/repo' });
//   const session = await client.createSession({ model: 'minimax/MiniMax-M2.7' });
//   const resp = await session.sendMessage(prompt);
//   // resp.text        — final LLM answer (no thought chunks)
//   // resp.toolCalls   — tool calls made during the turn
//   // tool calls are auto-logged to stdout as they happen
//
// Tool call logging (the [READING] / [BASH] / [EDIT] / [TODOS] prefixes
// the orchestrator log parser depends on) lives inside this client.
// Thought/reasoning chunks are excluded from resp.text but can still
// be streamed via the onTextDelta callback.

import { spawn, ChildProcess } from 'child_process';
import { AgentStatus } from './agent-status.js';
import {
    AcpError,
    type ContentBlock,
    type JsonRpcMessage,
    type JsonRpcNotification,
    type JsonRpcRequest,
    type JsonRpcResponse,
    type McpServer,
    type PermissionOption,
    type RequestPermissionOutcome,
    type RequestPermissionParams,
    type SessionConfigOption,
    type SessionModeState,
    type SessionNewResult,
    type SessionUpdate,
    type SessionNotification,
    type SetSessionConfigOptionParams,
    type SetSessionConfigOptionResult,
    type TextContent,
    type ToolCall,
    type ToolCallUpdate,
    type ToolKind,
    type Usage,
} from './acp-schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ACPLogger {
    info(msg: string): void;
    err(msg: string): void;
}

export interface ACPClientOptions {
    /** Working directory for the spawned `kilo acp` process. */
    cwd: string;
    /** Path or name of the `kilo` binary. Default: 'kilo' (uses $PATH). */
    kiloBinary?: string;
    /** Extra env vars for the spawned subprocess. */
    extraEnv?: Record<string, string>;
    /** Override the logger. Defaults to stdout/stderr. */
    logger?: ACPLogger;
    /** Timeout for the `initialize` handshake in ms. Default 60_000. */
    initTimeoutMs?: number;
    /**
     * Print every raw JSON-RPC message to stdout. Default: `false`.
     * Used for debugging the wire protocol only. To re-enable, also
     * flip the `if (false)` guard in `_start()`'s `onRawMessage`
     * callback. Each line would be prefixed `[acp-rpc] -> {...}`
     * (outbound) or `[acp-rpc] <- {...}` (inbound) with the full
     * JSON of the message.
     */
    traceJsonRpc?: boolean;
}

export interface ACPSessionConfig {
    /** Model ID, e.g. 'minimax/MiniMax-M2.7' or 'kilo/stealth/claude-sonnet-4.6'. */
    model: string;
    /** ACP mode. Default 'code'. */
    mode?: string;
    /** Reasoning effort. Default unset (kilo acp default). */
    reasoningEffort?: 'low' | 'medium' | 'high';
    /** Optional MCP servers to attach to the session. */
    mcpServers?: Array<{ name: string; transport?: unknown }>;
}

export interface ACPToolCall {
    callID: string;
    tool: string;            // 'read', 'write', 'edit', 'bash', 'grep', 'glob', 'todowrite', 'task', ...
    title?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    input?: Record<string, unknown>;
    output?: unknown;
}

export interface ACPSendOptions {
    /** Called for each non-thought text delta as it streams in. */
    onTextDelta?: (delta: string) => void;
    /** Called for each tool call as it's created or updated. */
    onToolCall?: (tc: ACPToolCall) => void;
}

export interface ACPResponse {
    /** Concatenated final-answer text (excludes thought/reasoning chunks). */
    text: string;
    /** All tool calls that fired during the turn, in invocation order. */
    toolCalls: ACPToolCall[];
    /** Stop reason from ACP (e.g. 'end_turn', 'max_tokens', 'cancelled'). */
    stopReason: string;
}

// ---------------------------------------------------------------------------
// Default logger — writes to stdout/stderr in the same shape the cloned
// messenger.ts interceptor in index.ts forwards to the orchestrator as `log`.
// ---------------------------------------------------------------------------

const defaultLogger: ACPLogger = {
    info: (msg) => process.stdout.write(`[acp-client] ${msg}\n`),
    err: (msg) => process.stderr.write(`[acp-client] ${msg}\n`),
};

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 client over the `kilo acp` subprocess stdio.
//
// Transport: newline-delimited JSON over stdio. The agent can send us
// requests (which we must respond to) and notifications (which we just
// observe). We support both directions:
//   - `sendRequest`/`sendNotification` — client → agent
//   - `onRequest`/`onNotification` — agent → client
// ---------------------------------------------------------------------------

export interface JsonRpcClientHandlers {
    onNotification: (method: string, params: unknown) => void;
    onRequest: (method: string, params: unknown) => Promise<unknown>;
    onStderr: (line: string) => void;
    /**
     * Optional hook for raw JSON-RPC message tracing. Called once per
     * outbound write ('out') and once per inbound parse ('in'). Use for
     * debugging the wire protocol. Implementations should not throw.
     */
    onRawMessage?: (direction: 'in' | 'out', msg: unknown) => void;
}

export class JsonRpcClient {
    private proc: ChildProcess;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private handlers: JsonRpcClientHandlers;
    private stdoutBuf = '';

    constructor(proc: ChildProcess, handlers: JsonRpcClientHandlers) {
        this.proc = proc;
        this.handlers = handlers;
        this.attach();
    }

    private attach(): void {
        this.proc.stdout?.on('data', (chunk: Buffer) => {
            this.stdoutBuf += chunk.toString();
            // ndjson: each line is one JSON message
            const lines = this.stdoutBuf.split('\n');
            this.stdoutBuf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                this.handleLine(line);
            }
        });
        let stderrBuf = '';
        this.proc.stderr?.on('data', (chunk: Buffer) => {
            stderrBuf += chunk.toString();
            const lines = stderrBuf.split('\n');
            stderrBuf = lines.pop() ?? '';
            for (const line of lines) {
                this.handlers.onStderr(line);
            }
        });
        this.proc.on('exit', (code) => {
            const err = new Error(`kilo acp exited with code ${code}`);
            for (const pending of this.pending.values()) {
                pending.reject(err);
            }
            this.pending.clear();
        });
    }

    private handleLine(line: string): void {
        let msg: JsonRpcMessage;
        try {
            msg = JSON.parse(line) as JsonRpcMessage;
        } catch {
            // Malformed JSON from the agent. Log to stderr (via
            // onStderr) so it shows up in the trace; don't pretend we
            // received a valid message.
            this.handlers.onStderr(`[non-json] ${line}`);
            return;
        }
        this.handlers.onRawMessage?.('in', msg);

        // Response to a request we sent
        if ('id' in msg && typeof (msg as JsonRpcResponse).id === 'number' && !('method' in msg)) {
            const response = msg as JsonRpcResponse;
            const handler = this.pending.get(response.id);
            if (!handler) return;
            this.pending.delete(response.id);
            if (response.error) {
                handler.reject(new AcpError(response.error.code, response.error.message, response.error.data));
            } else {
                handler.resolve(response.result);
            }
            return;
        }
        // Request from agent to client (e.g. session/request_permission)
        if ('method' in msg && 'id' in msg) {
            const req = msg as unknown as JsonRpcRequest;
            this.handleIncomingRequest(req);
            return;
        }
        // Notification from agent to client (e.g. session/update, session/cancel-not-needed)
        if ('method' in msg) {
            const notif = msg as JsonRpcNotification;
            try {
                this.handlers.onNotification(notif.method, notif.params);
            } catch (err) {
                defaultLogger.err(`notification handler threw: ${(err as Error).message}`);
            }
        }
    }

    private async handleIncomingRequest(req: JsonRpcRequest): Promise<void> {
        try {
            const result = await this.handlers.onRequest(req.method, req.params);
            this.writeResponse(req.id, result);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.writeError(req.id, -32603, error.message, error);
        }
    }

    private writeResponse(id: number, result: unknown): void {
        const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
        this.handlers.onRawMessage?.('out', resp);
        this.proc.stdin?.write(JSON.stringify(resp) + '\n');
    }

    private writeError(id: number, code: number, message: string, data?: unknown): void {
        const resp: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message, data } };
        this.handlers.onRawMessage?.('out', resp);
        this.proc.stdin?.write(JSON.stringify(resp) + '\n');
    }

    sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
        const id = this.nextId++;
        const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        this.handlers.onRawMessage?.('out', req);
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
            this.proc.stdin?.write(JSON.stringify(req) + '\n', (err) => {
                if (err) {
                    this.pending.delete(id);
                    reject(err);
                }
            });
        });
    }

    sendNotification(method: string, params?: unknown): void {
        const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
        this.handlers.onRawMessage?.('out', notif);
        this.proc.stdin?.write(JSON.stringify(notif) + '\n');
    }
}

// ---------------------------------------------------------------------------
// Translators — SessionUpdate → ACPToolCall / text delta
// ---------------------------------------------------------------------------

function textFromContent(content: ContentBlock): string | null {
    const block = content as TextContent;
    if (block && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
    }
    return null;
}

function mapToolKind(kind: ToolKind | undefined): string {
    if (!kind) return 'other';
    return kind;
}

function mapStatusToLegacy(status: 'pending' | 'in_progress' | 'completed' | 'failed'): ACPToolCall['status'] {
    return status;
}

function toolCallFromAcp(tc: ToolCall | ToolCallUpdate, fallbackStatus: ACPToolCall['status'] = 'pending'): ACPToolCall {
    const upd = tc as ToolCallUpdate;
    const result: ACPToolCall = {
        callID: tc.toolCallId,
        tool: mapToolKind(upd.kind ?? undefined),
        status: mapStatusToLegacy((upd.status ?? fallbackStatus) as 'pending' | 'in_progress' | 'completed' | 'failed'),
    };
    if (tc.title) result.title = tc.title;
    if (upd.rawInput !== undefined && upd.rawInput !== null) result.input = upd.rawInput as Record<string, unknown>;
    if (upd.rawOutput !== undefined && upd.rawOutput !== null) result.output = upd.rawOutput;
    return result;
}

// ---------------------------------------------------------------------------
// Per-session turn state — shared between ACPClient and ACPSession
// ---------------------------------------------------------------------------

interface TurnAccumulator {
    /**
     * Final response text, chained from agent_message_chunk and
     * user_message_chunk updates. Reasoning (agent_thought_chunk) is
     * intentionally NOT included — see handleSessionUpdate.
     */
    text: string;
    toolCalls: Map<string, ACPToolCall>;
    toolCallOrder: string[];           // preserve invocation order
    loggedToolCalls: Set<string>;       // dedup tool-call log output
    inFlightResolvers: Array<{
        resolve: (resp: ACPResponse) => void;
        reject: (err: Error) => void;
    }> | null;
    stopReason: string;
    /**
     * Whether the `<environment_details>` block has been emitted on
     * stdout for the current turn. The block is written once before
     * the first tool-call line of a turn, then this flag is set so
     * subsequent tool-call lines in the same turn are not prefixed
     * with another env block. Reset to `false` at the start of each
     * turn via `beginTurn`.
     */
    envBlockLogged: boolean;
}

function makeAccumulator(): TurnAccumulator {
    return {
        text: '',
        toolCalls: new Map(),
        toolCallOrder: [],
        loggedToolCalls: new Set(),
        inFlightResolvers: null,
        stopReason: 'end_turn',
        envBlockLogged: false,
    };
}

// ---------------------------------------------------------------------------
// ACPClient
// ---------------------------------------------------------------------------

export class ACPClient {
    private proc: ChildProcess | null = null;
    private rpc: JsonRpcClient | null = null;
    private sessions = new Map<string, { accumulator: TurnAccumulator }>();
    private started = false;
    private readonly cwd: string;
    private readonly kiloBinary: string;
    private readonly initTimeoutMs: number;
    private readonly extraEnv: Record<string, string>;
    private readonly logger: ACPLogger;
    private readonly traceJsonRpc: boolean;

    private constructor(options: ACPClientOptions) {
        this.cwd = options.cwd;
        this.kiloBinary = options.kiloBinary ?? 'kilo';
        this.initTimeoutMs = options.initTimeoutMs ?? 60_000;
        this.extraEnv = options.extraEnv ?? {};
        this.logger = options.logger ?? defaultLogger;
        this.traceJsonRpc = options.traceJsonRpc ?? false;
    }

    /**
     * Spawn `kilo acp` with the given cwd, complete the `initialize`
     * handshake, and resolve when the subprocess is ready to serve.
     */
    static async init(options: ACPClientOptions): Promise<ACPClient> {
        const initOptions: ACPClientOptions = {
            cwd: options.cwd,
            kiloBinary: options.kiloBinary ?? 'kilo',
            initTimeoutMs: options.initTimeoutMs ?? 60_000,
        };
        if (options.extraEnv !== undefined) initOptions.extraEnv = options.extraEnv;
        if (options.logger !== undefined) initOptions.logger = options.logger;
        const client = new ACPClient(initOptions);
        await client._start();
        return client;
    }

    private async _start(): Promise<void> {
        this.logger.info(`Starting kilo acp subprocess (cwd: ${this.cwd})`);
        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ...this.extraEnv,
            KILO_YOLO: '1',
            OPENCODE_YOLO: '1',
        };
        env['PATH'] = `/usr/local/lib/node_modules/.bin:/usr/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:${env['PATH'] || ''}`;

        const proc = spawn(this.kiloBinary, ['acp'], {
            cwd: this.cwd,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcess;
        this.proc = proc;

        const spawnError = new Promise<never>((_, reject) => {
            proc.on('error', (err) => {
                reject(new Error(`failed to spawn ${this.kiloBinary} acp: ${err.message}`));
            });
        });

        const rpc = new JsonRpcClient(proc, {
            onNotification: (method, params) => this.onAcpNotification(method, params),
            onRequest: (method, params) => this.handleIncomingRequest(method, params),
            onStderr: (line) => this.logger.err(`[kilo stderr] ${line}`),
            // [acp-rpc] wire trace — commented out. Kept here as a
            // debugging aid: set `traceJsonRpc: true` and re-enable
            // the body to dump every JSON-RPC message to stdout.
            onRawMessage: (direction, msg) => {
                if (false /* this.traceJsonRpc */) {
                    const arrow = direction === 'in' ? '<-' : '->';
                    this.logger.info(`[acp-rpc] ${arrow} ${JSON.stringify(msg)}`);
                }
                void msg;
            },
        });
        this.rpc = rpc;

        await Promise.race([
            rpc.sendRequest('initialize', {
                protocolVersion: 1,
                clientInfo: { name: 'openvelo-agent', version: '1.0.0' },
            }),
            spawnError,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`kilo acp did not respond to initialize within ${this.initTimeoutMs}ms`)), this.initTimeoutMs);
            }),
        ]);
        this.started = true;
        this.logger.info('kilo acp initialized successfully');
    }

    /**
     * Test seam: inject a custom JsonRpcClient and skip the kilo acp spawn.
     * Used by tests/unit/acp-client.test.ts.
     */
    setRpcForTesting(rpc: JsonRpcClient): void {
        this.rpc = rpc;
        this.started = true;
    }

    /**
     * Create a new ACP session. Calls `session/new` then sets the model,
     * mode, and reasoning effort via `session/set_config_option`.
     *
     * The `reasoningEffort` config ID in ACP is `effort` (per kilo's
     * `setSessionConfigOption` handler in agent.ts:1280-1302).
     */
    async createSession(config: ACPSessionConfig): Promise<ACPSession> {
        if (!this.rpc) throw new Error('ACPClient not started');

        AgentStatus.clearPlan();

        const result = await this.rpc.sendRequest<SessionNewResult>('session/new', {
            cwd: this.cwd,
            mcpServers: config.mcpServers ?? [],
        });
        const sessionId = result.sessionId;

        // 2-step setup: set model/mode/effort as session-level config
        // options. Failures are non-fatal — the session still works with
        // kilo acp's defaults.
        await this.trySetConfigOption(sessionId, 'model', config.model);
        if (config.mode) {
            await this.trySetConfigOption(sessionId, 'mode', config.mode);
        }
        if (config.reasoningEffort) {
            // kilo ACP uses configId="effort" for reasoning effort
            await this.trySetConfigOption(sessionId, 'effort', config.reasoningEffort);
        }

        this.sessions.set(sessionId, { accumulator: makeAccumulator() });
        const session = new ACPSession(this, sessionId);
        if (config.mode) session.currentMode = config.mode;
        return session;
    }

    /** Look up an existing session by id. */
    getSession(id: string): ACPSession | undefined {
        if (!this.sessions.has(id)) return undefined;
        return new ACPSession(this, id);
    }

    /** Whether the underlying `kilo acp` subprocess is initialized. */
    isStarted(): boolean {
        return this.started;
    }

    /**
     * Send an arbitrary JSON-RPC request. Used by ACPSession for methods
     * that don't have a dedicated accessor on ACPClient (e.g.
     * `session/set_mode`).
     */
    async sendRequestRaw<T = unknown>(method: string, params?: unknown): Promise<T> {
        if (!this.rpc) throw new Error('ACPClient not started');
        return this.rpc.sendRequest<T>(method, params);
    }

    /** Kill the subprocess and clean up. */
    async shutdown(): Promise<void> {
        if (this.proc) {
            try {
                this.proc.kill('SIGTERM');
            } catch { /* ignore */ }
            this.proc = null;
        }
        this.rpc = null;
        this.started = false;
        this.sessions.clear();
    }

    // -------------------------------------------------------------------------
    // Internal: session/turn plumbing used by ACPSession
    // -------------------------------------------------------------------------

    /** Begin a new turn for the given session, returning the accumulator. */
    beginTurn(sessionId: string): TurnAccumulator {
        const entry = this.sessions.get(sessionId);
        if (!entry) throw new Error(`unknown session: ${sessionId}`);
        // Reset per-turn state, keep toolCallOrder but clear contents
        entry.accumulator.text = '';
        entry.accumulator.toolCalls.clear();
        entry.accumulator.toolCallOrder = [];
        entry.accumulator.loggedToolCalls.clear();
        entry.accumulator.inFlightResolvers = null;
        entry.accumulator.stopReason = 'end_turn';
        entry.accumulator.envBlockLogged = false;
        return entry.accumulator;
    }

    /** Internal: dispatch a session/update notification. */
    handleSessionUpdate(sessionId: string, update: SessionUpdate): void {
        let entry = this.sessions.get(sessionId);
        if (!entry) {
            // The agent may send an update for a session we just closed
            // (e.g. a final tool_call_update arrives after we deleted
            // the session). Drop the update silently instead of erroring.
            this.logger.err(`session/update for unknown session ${sessionId}`);
            return;
        }
        const acc = entry.accumulator;
        switch (update.sessionUpdate) {
            case 'agent_message_chunk': {
                // Only the agent's final-answer chunks are chained into
                // `acc.text`. user_message_chunk (only seen during history
                // replay) and agent_thought_chunk (reasoning) are not.
                const text = textFromContent(update.content);
                if (text !== null && text.length > 0) {
                    acc.text += text;
                    // Stream the final-answer text to stdout as it
                    // arrives, mirroring agent_thought_chunk. No
                    // prefix, no trailing newline, no per-turn
                    // framing — just the raw text appended so the
                    // operator can watch the LLM's answer live.
                    //
                    // Note: ACPSession.sendMessage's onTextDelta
                    // callback is invoked separately by the session
                    // itself (it owns the callback). The client just
                    // keeps the accumulator in sync.
                    process.stdout.write(text);
                }
                return;
            }
            case 'agent_thought_chunk': {
                // Stream reasoning / thinking to stdout as it comes.
                // No prefix, no trailing newline, no per-turn framing
                // — just the raw text appended to stdout so the
                // operator can watch the chain-of-thought live.
                //
                // Reasoning is NOT added to acc.text — it remains
                // separate from the final response. See
                // handleSessionUpdate's `case 'agent_message_chunk'`.
                const text = textFromContent(update.content);
                if (text !== null && text.length > 0) {
                    process.stdout.write(text);
                }
                return;
            }
            case 'tool_call': {
                const tc = toolCallFromAcp(update, 'pending');
                acc.toolCalls.set(tc.callID, tc);
                acc.toolCallOrder.push(tc.callID);
                this.maybeLogToolCall(acc, tc);
                return;
            }
            case 'tool_call_update': {
                const existing = acc.toolCalls.get(update.toolCallId);
                const merged: ACPToolCall = existing
                    ? { ...existing, ...toolCallFromAcp(update, existing.status) }
                    : toolCallFromAcp(update, 'pending');
                acc.toolCalls.set(update.toolCallId, merged);
                if (!existing) acc.toolCallOrder.push(update.toolCallId);
                this.maybeLogToolCall(acc, merged);
                return;
            }
            case 'plan': {
                // Kilo sends todowrite's todos as a `plan` notification
                // (with PlanEntry[]), separate from the tool_call
                // notifications for the todowrite tool itself. See kilo
                // acp/agent.ts:354-379. Log the todos here and skip the
                // tool call's own log line in maybeLogToolCall to avoid
                // double-logging.
                const logLine = this.formatPlanLog(update.entries);
                if (logLine) this.logger.info(logLine);
                AgentStatus.setPlanEntries(update.entries);
                return;
            }
            case 'user_message_chunk':
            case 'current_mode_update':
            case 'available_commands_update':
            case 'config_option_update':
            case 'session_info_update':
                // Informational; not surfaced to the workflow.
                return;
            case 'usage_update': {
                // Kilo sends used/size/cost as a session/update
                // notification around every turn boundary
                // (see kilo acp/agent.ts:87-135, sendUsageUpdate).
                // Forward to AgentStatus so consumers can render the
                // context bar.
                const ctxUpdate: { used: number; size: number; cost?: { amount: number; currency: string } } = {
                    used: update.used,
                    size: update.size,
                };
                if (update.cost !== undefined) ctxUpdate.cost = update.cost;
                AgentStatus.setContextUpdate(ctxUpdate);
                return;
            }
            default: {
                const _exhaustive: never = update;
                void _exhaustive;
                return;
            }
        }
    }

    /**
     * Internal: handle an incoming JSON-RPC request from the agent. The
     * agent sends us requests like `session/request_permission` (a
     * request, not a notification) and expects a normal JSON-RPC response
     * carrying the outcome. See kilo agent.ts:207-232 for the
     * corresponding `connection.requestPermission({...})` call.
     */
    private async handleIncomingRequest(method: string, params: unknown): Promise<unknown> {
        if (method === 'session/request_permission') {
            const p = params as RequestPermissionParams;
            return this.handleRequestPermission(p);
        }
        if (method === 'fs/read_text_file') {
            // We don't expose the client's filesystem to the agent; refuse
            // politely so the agent can fall back to bash.
            throw new AcpError(-32601, 'fs/read_text_file not supported by this client');
        }
        if (method === 'fs/write_text_file') {
            throw new AcpError(-32601, 'fs/write_text_file not supported by this client');
        }
        if (method === 'terminal/create') {
            throw new AcpError(-32601, 'terminal/create not supported by this client');
        }
        // Unknown method — JSON-RPC method-not-found
        throw new AcpError(-32601, `method not found: ${method}`);
    }

    /**
     * Auto-grant permission: pick the first `allow_*` option, or fall back
     * to the first option. Returns the RequestPermissionResponse the
     * agent expects.
     */
    private handleRequestPermission(params: RequestPermissionParams): { outcome: RequestPermissionOutcome } {
        const allowOption = params.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always') ?? params.options[0];
        if (!allowOption) {
            this.logger.err(`permission request with no options for session ${params.sessionId}`);
            return { outcome: { outcome: 'cancelled' } };
        }
        return {
            outcome: {
                outcome: 'selected',
                optionId: allowOption.optionId,
            },
        };
    }

    /**
     * Internal: cancel a session. Sends `session/cancel` as a notification
     * (not a request) per the ACP spec.
     */
    cancelSession(sessionId: string): void {
        if (!this.rpc) return;
        this.rpc.sendNotification('session/cancel', { sessionId, _meta: null });
    }

    /** Internal: close a session. */
    async closeSession(sessionId: string): Promise<void> {
        if (!this.rpc) return;
        try {
            await this.rpc.sendRequest('session/close', { sessionId });
        } catch { /* ignore */ }
        this.sessions.delete(sessionId);
    }

    /** Internal: send a session/prompt and resolve with the assembled response. */
    async sendPrompt(
        sessionId: string,
        prompt: ContentBlock[],
        options: ACPSendOptions = {},
    ): Promise<ACPResponse> {
        if (!this.rpc) throw new Error('ACPClient not started');
        const entry = this.sessions.get(sessionId);
        if (!entry) throw new Error(`unknown session: ${sessionId}`);
        const acc = entry.accumulator;
        if (acc.inFlightResolvers) {
            throw new Error(`turn already in flight for session ${sessionId}`);
        }

        return new Promise<ACPResponse>((resolve, reject) => {
            acc.inFlightResolvers = [{
                resolve: (resp) => resolve(resp),
                reject: (err) => reject(err),
            }];

            // Set up a turn-completion promise that resolves when the
            // session/prompt JSON-RPC response arrives. There is no
            // client-side wall-clock cap: the orchestrator's inactivity
            // timer is the sole safety net for stuck turns.
            const turnPromise = this.rpc!.sendRequest<{ stopReason?: string; usage?: Usage }>('session/prompt', {
                sessionId,
                prompt,
            });

            turnPromise.then(
                (result) => {
                    acc.stopReason = result?.stopReason ?? 'end_turn';
                    if (result?.usage) {
                        AgentStatus.setUsage(result.usage);
                    }
                    const response: ACPResponse = {
                        text: acc.text,
                        toolCalls: acc.toolCallOrder
                            .map((id) => acc.toolCalls.get(id))
                            .filter((tc): tc is ACPToolCall => tc !== undefined),
                        stopReason: acc.stopReason,
                    };
                    // Invoke onToolCall for any final updates
                    if (options.onToolCall) {
                        for (const tc of response.toolCalls) options.onToolCall(tc);
                    }
                    const resolvers = acc.inFlightResolvers;
                    acc.inFlightResolvers = null;
                    if (resolvers) resolvers.forEach((r) => r.resolve(response));
                },
                (err) => {
                    const resolvers = acc.inFlightResolvers;
                    acc.inFlightResolvers = null;
                    if (resolvers) resolvers.forEach((r) => r.reject(err));
                },
            );
        });
    }

    /** Read-only access to the per-session accumulator (for streaming callbacks). */
    getAccumulator(sessionId: string): TurnAccumulator | undefined {
        return this.sessions.get(sessionId)?.accumulator;
    }

    // -------------------------------------------------------------------------
    // Internal: notification dispatch
    // -------------------------------------------------------------------------

    private onAcpNotification(method: string, params: unknown): void {
        if (method === 'session/update') {
            const notif = params as SessionNotification;
            this.handleSessionUpdate(notif.sessionId, notif.update);
            return;
        }
        // session/cancel is a CLIENT→AGENT notification; the agent never
        // sends it to us. All other notifications from the agent are
        // ignored.
    }

    private async trySetConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
        if (!this.rpc) return;
        try {
            await this.rpc.sendRequest('session/set_config_option', {
                sessionId,
                configId,
                value,
            });
        } catch (err) {
            this.logger.err(`set_config_option(${configId}=${value}) failed: ${(err as Error).message}`);
        }
    }

    // -------------------------------------------------------------------------
    // Internal: tool-call log formatting — preserved from the cloned
    // opencode-server.ts so the orchestrator log shape is unchanged.
    // -------------------------------------------------------------------------

    private maybeLogToolCall(acc: TurnAccumulator, tc: ACPToolCall): void {
        if (acc.loggedToolCalls.has(tc.callID)) return;
        const toolName = tc.tool || 'unknown';
        // `diff` is a content type within a tool call, not a separate tool.
        if (toolName === 'diff') return;
        // `todowrite` todos are logged via the separate `plan`
        // notification (see handleSessionUpdate's `case 'plan'`). Skip
        // here to avoid double-logging an empty line — the initial
        // `tool_call` for todowrite has `rawInput: {}` and `status:
        // 'pending'`, which would otherwise log a bare `[TODOS]`.
        if (toolName === 'todowrite') return;

        const status = tc.status;
        const isFinished = status === 'completed' || status === 'failed';
        if (!isFinished && this.isToolInputIncomplete(toolName, tc.input)) {
            return;
        }
        acc.loggedToolCalls.add(tc.callID);
        // Tool call lines are written to stdout directly (bypassing
        // this.logger.info) so the line has no `[acp-client]` prefix.
        // The first tool-call line of a turn is preceded by an
        // `<environment_details>` block (cwd + current time).
        // Subsequent tool-call lines in the same turn are emitted
        // bare — `envBlockLogged` flips once and resets per turn.
        // The leading `\n` and the optional env block are baked
        // into `formatToolLog` itself so the caller stays a
        // one-liner.
        process.stdout.write(
            this.formatToolLog(toolName, tc.input, !acc.envBlockLogged),
        );
        acc.envBlockLogged = true;
    }

    /**
     * Build the `<environment_details>` block emitted before each
     * tool-call line on stdout. Format mirrors the Cline / cline-bot
     * convention so external tools that already parse this shape work
     * unchanged. Local-time ISO 8601 with timezone offset (e.g.
     * `2026-06-08T01:09:02+02:00`).
     */
    private formatEnvironmentDetails(): string {
        const cwd = process.cwd();
        const d = new Date();
        const pad = (n: number): string => String(n).padStart(2, '0');
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        // `getTimezoneOffset()` returns minutes WEST of UTC, so a
        // positive value means we're behind UTC. The format we emit
        // uses the conventional `+HH:MM` (east) / `-HH:MM` (west).
        const offsetMin = d.getTimezoneOffset();
        const sign = offsetMin <= 0 ? '+' : '-';
        const offsetAbs = Math.abs(offsetMin);
        const offsetH = pad(Math.floor(offsetAbs / 60));
        const offsetM = pad(offsetAbs % 60);
        const currentTime = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${offsetH}:${offsetM}`;
        return [
            '<environment_details>',
            `Current time: ${currentTime}`,
            `Working directory: ${cwd}`,
            `Workspace root folder: ${cwd}`,
            '</environment_details>',
        ].join('\n');
    }

    /**
     * Write the prompt we're about to send to the LLM to stdout,
     * prefixed by the `<environment_details>` block (cwd + current
     * time). The format matches the Cline / cline-bot convention
     * so external tools that already parse this shape work
     * unchanged. The env block is emitted at the top of every
     * turn; tool-call logging uses a separate flag
     * (`acc.envBlockLogged`) to avoid emitting a second env block
     * between the prompt and the first tool call of the same
     * turn — both share the same `<environment_details>` block.
     */
    public logPromptToStdout(prompt: string): void {
        const env = this.formatEnvironmentDetails();
        // Truncate very long prompts so the stdout stays readable
        // when the LLM is being asked a long question (e.g., a
        // multi-kilobyte plan).
        const truncated = prompt.length > 2000
            ? prompt.slice(0, 2000) + `\n[... ${prompt.length - 2000} more chars ...]`
            : prompt;
        process.stdout.write(`\n${env}\n\n[user message sent to LLM]\n${truncated}\n`);
    }

    private formatToolLog(
        toolName: string,
        input?: Record<string, unknown>,
        includeEnvBlock: boolean = false,
    ): string {
        let body: string;
        switch (toolName) {
            case 'read':
                body = `[READING] ${input?.['filePath'] ?? 'unknown'}`;
                break;

            case 'bash':
            case 'execute': {
                // `execute` is the ToolKind kilo emits for the shell
                // tool (ShellID.ToolID in kilo acp/agent.ts:418). It
                // has the same input shape as `bash` (command +
                // description).
                const description = input?.['description'] as string | undefined;
                const command = input?.['command'] as string | undefined;
                const desc = description ?? '';
                const cmd = command ?? '';
                body = `[EXEC] ${desc}\n  - ${cmd}`;
                break;
            }

            case 'glob':
                body = `[GLOB] ${input?.['pattern'] ?? ''}`;
                break;

            case 'todowrite':
                body = this.formatTodosLog(input);
                break;

            case 'write':
                body = `[WRITING] ${input?.['filePath'] ?? 'unknown'}`;
                break;

            case 'grep': {
                const pattern = input?.['pattern'] as string | undefined;
                const path = input?.['path'] as string | undefined;
                body = `[GREP] "${pattern ?? ''}" in ${path ?? '.'}`;
                break;
            }

            case 'search': {
                // `search` is the ToolKind kilo emits for the
                // repo_overview / context7_* tools. They have
                // different input shapes — repo_overview uses
                // `repository` / `path`, context7 uses `libraryId` /
                // `libraryName` / `topic`. Show whatever query fields
                // are present, comma-separated.
                const parts: string[] = [];
                const candidates = ['repository', 'path', 'libraryId', 'libraryName', 'topic', 'query'];
                for (const key of candidates) {
                    const v = input?.[key];
                    if (typeof v === 'string' && v.length > 0) parts.push(`${key}=${v}`);
                }
                const tail = input?.['depth'] !== undefined ? ` depth=${input['depth']}` : '';
                body = `[SEARCH] ${parts.join(', ')}${tail}`;
                break;
            }

            case 'edit':
                body = `[EDIT] ${input?.['filePath'] ?? 'unknown'}`;
                break;

            case 'task': {
                const description = input?.['description'] as string | undefined;
                const subagentType = input?.['subagent_type'] as string | undefined;
                const taskId = input?.['task_id'] as string | undefined;
                const headline = description || (taskId ? `resuming ${taskId}` : 'subagent task');
                const tag = subagentType ? ` (@${subagentType})` : '';
                body = `[TASK] ${headline}${tag}`;
                break;
            }

            default: {
                // For unknown tools, dump the input as compact JSON so
                // the operator can see *something* even if we don't
                // have a dedicated formatter. Long values are
                // truncated to keep the stdout readable.
                const json = JSON.stringify(input ?? {});
                const truncated = json.length > 200 ? json.slice(0, 200) + '…' : json;
                body = `[TOOL] ${toolName}: ${truncated}`;
                break;
            }
        }
        // Prepend a `\n` for spacing from the previous line of
        // stdout. The first tool-call line of a turn is also
        // preceded by the `<environment_details>` block (cwd +
        // current time); subsequent lines in the same turn are bare.
        // The env-block gate is at the caller (see maybeLogToolCall
        // + TurnAccumulator.envBlockLogged).
        const envPrefix = includeEnvBlock
            ? `\n${this.formatEnvironmentDetails()}\n`
            : '';
        return `${envPrefix}\n${body}\n`;
    }

    private formatTodosLog(input?: Record<string, unknown>): string {
        const todos = input?.['todos'] as Array<{ content?: string; status?: string } | undefined>;
        if (!todos || !Array.isArray(todos)) return '[TODOS]';

        const lines: string[] = ['[TODOS]:'];
        for (const todo of todos) {
            if (!todo) continue;
            const status = (todo.status ?? 'pending').toUpperCase();
            const check = status === 'COMPLETED' ? '✓' : '○';
            lines.push(`  [${check}] ${todo.content ?? ''}`);
        }
        return lines.join('\n');
    }

    /**
     * Format a `plan` notification (which carries todowrite's todos as
     * PlanEntry[]) for the orchestrator log. PlanEntry has `{ content,
     * status, priority }` per the ACP spec (kilo acp-schema.ts:1353+).
     */
    private formatPlanLog(entries: Array<{ content?: string; status?: string; priority?: string }>): string {
        if (!entries || entries.length === 0) return '';
        const lines: string[] = ['[TODOS]:'];
        for (const entry of entries) {
            const status = (entry.status ?? 'pending').toUpperCase();
            const check =
                status === 'COMPLETED' ? '✓' :
                status === 'IN_PROGRESS' ? '◐' :
                '○';
            lines.push(`  [${check}] ${entry.content ?? ''}`);
        }
        return lines.join('\n');
    }

    private isToolInputIncomplete(toolName: string, input?: Record<string, unknown>): boolean {
        if (!input) return true;
        switch (toolName) {
            case 'read':
            case 'write':
            case 'edit':
                return !input['filePath'] || typeof input['filePath'] !== 'string';
            case 'bash':
            case 'execute':
                return !input['command'] || typeof input['command'] !== 'string';
            case 'glob':
                return !input['pattern'] || typeof input['pattern'] !== 'string';
            case 'grep':
                return !input['pattern'] || typeof input['pattern'] !== 'string';
            case 'search': {
                // At least one of the recognized query fields must
                // be present, otherwise the tool call was fired
                // with no query and we should wait for the
                // tool_call_update with the real input.
                const queryKeys = ['repository', 'path', 'libraryId', 'libraryName', 'topic', 'query'];
                return !queryKeys.some((k) => {
                    const v = input[k];
                    return typeof v === 'string' && v.length > 0;
                });
            }
            default:
                return false;
        }
    }
}

// ---------------------------------------------------------------------------
// ACPSession — represents a single ACP session. Use ACPClient.createSession
// to construct one; never `new ACPSession(...)` directly.
// ---------------------------------------------------------------------------

export class ACPSession {
    readonly id: string;
    private client: ACPClient;
    private inFlight = false;
    /** Cached current mode ID (set by setMode, defaults to the value at createSession). */
    currentMode: string | undefined;

    constructor(client: ACPClient, id: string) {
        this.client = client;
        this.id = id;
    }

    /**
     * Send a prompt and resolve when the turn ends. Returns the
     * accumulated final-answer text and the list of tool calls made
     * during the turn. Tool calls are auto-logged to stdout by the
     * client; thought/reasoning chunks are NOT included in the text.
     */
    async sendMessage(prompt: string, options: ACPSendOptions = {}): Promise<ACPResponse> {
        if (this.inFlight) {
            throw new Error(`turn already in flight for session ${this.id}`);
        }
        this.inFlight = true;

        // Start a new turn (resets the per-session accumulator).
        const acc = this.client.beginTurn(this.id);

        // Log the prompt being sent to the LLM. The
        // `<environment_details>` block goes once at the top of the
        // turn (cwd + current time), then the prompt text follows
        // on the next line. The flag is then flipped so the first
        // tool-call line of this turn does NOT re-emit the env
        // block — the prompt log and the first tool call share
        // the same `<environment_details>` block.
        this.client.logPromptToStdout(prompt);
        acc.envBlockLogged = true;

        // Hook a streaming observer: watch the accumulator's text and
        // invoke onTextDelta for new deltas as they arrive. We do this
        // by polling the accumulator on each microtask — the alternative
        // (a per-chunk callback in handleSessionUpdate) would couple the
        // client to a per-session options object, which is messier.
        // Polling is cheap and the turns are coarse-grained.
        let lastSeenText = '';
        let streamObserver: NodeJS.Immediate | null = null;
        const streamLoop = (): void => {
            if (!this.inFlight) return;
            if (acc.text !== lastSeenText && options.onTextDelta) {
                const delta = acc.text.slice(lastSeenText.length);
                lastSeenText = acc.text;
                options.onTextDelta(delta);
            }
            streamObserver = setImmediate(streamLoop);
        };
        if (options.onTextDelta) {
            streamObserver = setImmediate(streamLoop);
        }

        try {
            const response = await this.client.sendPrompt(
                this.id,
                [{ type: 'text', text: prompt }],
                options,
            );
            return response;
        } finally {
            this.inFlight = false;
            if (streamObserver) clearImmediate(streamObserver);
        }
    }

    /** Cancel the in-flight turn, if any. Best-effort. */
    async cancel(): Promise<void> {
        this.client.cancelSession(this.id);
    }

    /**
     * Switch this session's mode (e.g. 'plan' → 'code'). Per kilo's
     * handler at acp/agent.ts:1264-1271 this is a state-only mutation;
     * the new modeId is stored and takes effect on the next
     * `session/prompt`.
     */
    async setMode(modeId: string): Promise<void> {
        if (!this.client.isStarted()) throw new Error('ACPClient not started');
        await this.client.sendRequestRaw('session/set_mode', {
            sessionId: this.id,
            modeId,
        });
        this.currentMode = modeId;
    }

    /**
     * Switch this session's model. Implemented as a
     * `session/set_config_option` RPC (configId "model") — the same
     * RPC `createSession` uses at acp-client.ts:471 to set the
     * initial model. The new model takes effect on the next
     * `session/prompt` turn, matching `setMode`'s semantics.
     */
    async setModel(modelId: string): Promise<void> {
        if (!this.client.isStarted()) throw new Error('ACPClient not started');
        await this.client.sendRequestRaw('session/set_config_option', {
            sessionId: this.id,
            configId: 'model',
            value: modelId,
        });
    }

    /** Close the session (sends `session/close`). */
    async close(): Promise<void> {
        await this.client.closeSession(this.id);
    }
}
