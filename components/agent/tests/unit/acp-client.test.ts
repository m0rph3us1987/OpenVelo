import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { ACPClient, ACPSession, JsonRpcClient } from '../../src/acp-client.js';
import type { ACPLogger } from '../../src/acp-client.js';
import type { SessionUpdate } from '../../src/acp-schema.js';
import { AgentStatus } from '../../src/agent-status.js';

// ---------------------------------------------------------------------------
// Test infrastructure: mock JsonRpcClient that records calls and lets the
// test push session/update notifications. Avoids spawning a real `kilo acp`.
// ---------------------------------------------------------------------------

interface MockRpc extends EventEmitter {
    sendRequest: <T>(method: string, params?: unknown) => Promise<T>;
    sendNotification: (method: string, params?: unknown) => void;
    calls: Array<{ method: string; params: unknown; type: 'request' | 'notification' }>;
    /** Pending request resolvers keyed by method, for the test to fire later. */
    pendingResolvers: Map<string, Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }>>;
}

function makeMockRpc(): MockRpc {
    const calls: MockRpc['calls'] = [];
    const pendingResolvers = new Map<string, Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }>>();
    const rpc = new EventEmitter() as MockRpc;
    rpc.calls = calls;
    rpc.pendingResolvers = pendingResolvers;
    rpc.sendRequest = <T>(method: string, params?: unknown): Promise<T> => {
        calls.push({ method, params, type: 'request' });
        return new Promise<T>((resolve, reject) => {
            const list = pendingResolvers.get(method) ?? [];
            list.push({ resolve: resolve as (v: unknown) => void, reject });
            pendingResolvers.set(method, list);
        });
    };
    rpc.sendNotification = (method: string, params?: unknown): void => {
        calls.push({ method, params, type: 'notification' });
    };
    return rpc;
}

/** Capture logger for assertions. */
function makeCaptureLogger(): ACPLogger & { lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        info: (msg) => lines.push(`INFO: ${msg}`),
        err: (msg) => lines.push(`ERR: ${msg}`),
    };
}

/** Drive a session/update notification through the client's event channel. */
function pushSessionUpdate(client: ACPClient, sessionId: string, update: SessionUpdate): void {
    // The mock's onNotification is the EventEmitter; we emit on it.
    (client as unknown as { rpc: EventEmitter }).rpc.emit('notif', 'session/update', { sessionId, update });
}

// ---------------------------------------------------------------------------
// Translator / handleSessionUpdate unit tests
// ---------------------------------------------------------------------------

describe('ACPClient session/update handling', () => {
    let client: ACPClient;
    let mock: MockRpc;
    let logger: ACPLogger & { lines: string[] };

    before(() => {
        mock = makeMockRpc();
        logger = makeCaptureLogger();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger,
        });
        // Inject the mock JsonRpcClient — the constructor doesn't spawn.
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
        // Register a session manually (skip createSession's set_config_option)
        (client as unknown as { sessions: Map<string, { accumulator: ReturnType<typeof makeAccumulator> }> }).sessions.set('ses_t', {
            accumulator: {
                text: '',
                toolCalls: new Map(),
                toolCallOrder: [],
                loggedToolCalls: new Set(),
                todowriteCallIds: new Set(),
                inFlightResolvers: null,
                stopReason: 'end_turn',
                envBlockLogged: false,
            },
        });
    });

    after(() => {
        // nothing to clean
    });

    it('agent_message_chunk appends to accumulator text', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = '';
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'hello ' },
        });
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'world' },
        });
        assert.strictEqual(acc.text, 'hello world');
    });

    it('agent_thought_chunk is filtered out of acc.text but written raw to stdout', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = '';
        // Intercept process.stdout.write to capture what the client
        // streams (without polluting the test runner's output).
        const written: string[] = [];
        const origWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array): boolean => {
            if (typeof chunk === 'string') written.push(chunk);
            return true;
        }) as typeof process.stdout.write;
        try {
            client.handleSessionUpdate('ses_t', {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'thinking hard... ' },
            });
            client.handleSessionUpdate('ses_t', {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'final answer' },
            });
        } finally {
            process.stdout.write = origWrite;
        }
        // Reasoning is NOT part of the response text.
        assert.strictEqual(acc.text, 'final answer');
        // Both chunks are streamed to stdout raw, no prefix, no newline —
        // just the LLM's stream of consciousness + final answer appended.
        assert.deepStrictEqual(written, ['thinking hard... ', 'final answer']);
    });

    it('multiple thought chunks stream contiguously to stdout (no prefix, no per-chunk newline)', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = '';
        const written: string[] = [];
        const origWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array): boolean => {
            if (typeof chunk === 'string') written.push(chunk);
            return true;
        }) as typeof process.stdout.write;
        try {
            client.handleSessionUpdate('ses_t', {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'first part ' },
            });
            client.handleSessionUpdate('ses_t', {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'second part ' },
            });
            client.handleSessionUpdate('ses_t', {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'third part' },
            });
        } finally {
            process.stdout.write = origWrite;
        }
        assert.deepStrictEqual(written, ['first part ', 'second part ', 'third part']);
    });

    it('user_message_chunk does NOT contribute to acc.text (history replay only)', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = '';
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'user side: ' },
        });
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'agent side' },
        });
        // Only the agent's message chunks contribute to acc.text. The
        // user_message_chunk (from history replay) is dropped.
        assert.strictEqual(acc.text, 'agent side');
    });

    it('non-text agent_message_chunk (e.g. image) is ignored', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = 'before ';
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        });
        assert.strictEqual(acc.text, 'before ');
    });

    it('tool_call creates an entry in toolCalls map', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'tool_call',
            toolCallId: 'call_001',
            title: 'Reading package.json',
            kind: 'read',
            status: 'pending',
        });
        const tc = acc.toolCalls.get('call_001');
        assert.ok(tc, 'expected tool call in accumulator');
        assert.strictEqual(tc!.tool, 'read');
        assert.strictEqual(tc!.status, 'pending');
        assert.deepStrictEqual(acc.toolCallOrder, ['call_001']);
    });

    it('tool_call_update merges with existing entry', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'tool_call',
            toolCallId: 'call_002',
            title: 'Bash',
            kind: 'bash',
            status: 'pending',
        });
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call_002',
            status: 'in_progress',
            rawInput: { command: 'ls' },
        });
        const tc = acc.toolCalls.get('call_002');
        assert.ok(tc);
        assert.strictEqual(tc!.status, 'in_progress');
        assert.deepStrictEqual(tc!.input, { command: 'ls' });
        assert.deepStrictEqual(acc.toolCallOrder, ['call_002']);
    });

    it('plan notification logs todos via [TODOS]: format', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = 'unchanged';
        acc.toolCalls.clear();
        logger.lines.length = 0;
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'plan',
            entries: [
                { content: 'First', priority: 'high', status: 'completed' },
                { content: 'Second', priority: 'medium', status: 'in_progress' },
                { content: 'Third', priority: 'low', status: 'pending' },
            ],
        });
        assert.strictEqual(acc.text, 'unchanged');
        assert.strictEqual(acc.toolCalls.size, 0);
        assert.deepStrictEqual(logger.lines, [
            'INFO: [TODOS]:\n  [✓] First\n  [◐] Second\n  [○] Third',
        ]);
    });

    it('todowrite tool call forwards todos to AgentStatus and logs [TODOS]:', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.todowriteCallIds.clear();
        logger.lines.length = 0;
        AgentStatus.setPlanEntries([]);

        // Initial pending tool_call: title is the raw tool name, kind is
        // the generic 'other', rawInput is empty.
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'tool_call',
            toolCallId: 'call_todo',
            title: 'todowrite',
            kind: 'other',
            status: 'pending',
        });
        // The callID is now tracked as a todowrite call.
        assert.ok(acc.todowriteCallIds.has('call_todo'));

        // Running update carries the todo list in rawInput; title is
        // renamed to "<n> todos".
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call_todo',
            status: 'in_progress',
            title: '2 todos',
            rawInput: {
                todos: [
                    { content: 'Bring repo to State X', status: 'completed', priority: 'high' },
                    { content: 'Restore dependencies', status: 'in_progress', priority: 'medium' },
                    { content: 'Skipped step', status: 'cancelled', priority: 'low' },
                ],
            },
        });

        // Forwarded to AgentStatus (cancelled collapses to completed).
        assert.deepStrictEqual(AgentStatus.planEntries, [
            { content: 'Bring repo to State X', status: 'completed', priority: 'high' },
            { content: 'Restore dependencies', status: 'in_progress', priority: 'medium' },
            { content: 'Skipped step', status: 'completed', priority: 'low' },
        ]);
        // Logged in the [TODOS]: shape, not as a bare [TOOL] other line.
        assert.deepStrictEqual(logger.lines, [
            'INFO: [TODOS]:\n  [✓] Bring repo to State X\n  [◐] Restore dependencies\n  [✓] Skipped step',
        ]);
    });

    it('user_message_chunk / current_mode_update / config_option_update / session_info_update are no-ops', () => {
        const acc = client.getAccumulator('ses_t')!;
        acc.text = 'unchanged';
        acc.toolCalls.clear();
        logger.lines.length = 0;
        const updates: SessionUpdate[] = [
            { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } },
            { sessionUpdate: 'current_mode_update', modeId: 'code' },
            { sessionUpdate: 'config_option_update', configOptions: [] },
            { sessionUpdate: 'session_info_update', title: 'New Title' },
        ];
        for (const u of updates) client.handleSessionUpdate('ses_t', u);
        assert.strictEqual(acc.text, 'unchanged');
        assert.strictEqual(acc.toolCalls.size, 0);
        assert.strictEqual(logger.lines.length, 0);
    });

    it('usage_update notification is forwarded to AgentStatus.setContextUpdate', () => {
        // Snapshot the pre-state so we can assert the post-state without
        // resetting the singleton.
        const before = AgentStatus.contextUpdate;
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'usage_update',
            used: 9500,
            size: 200000,
            cost: { amount: 0.0234, currency: 'USD' },
        });
        const after = AgentStatus.contextUpdate;
        assert.notStrictEqual(after, before, 'contextUpdate reference should change');
        assert.strictEqual(after?.used, 9500);
        assert.strictEqual(after?.size, 200000);
        assert.deepStrictEqual(after?.cost, { amount: 0.0234, currency: 'USD' });
    });

    it('usage_update without cost is accepted and forwarded to AgentStatus', () => {
        const before = AgentStatus.contextUpdate;
        client.handleSessionUpdate('ses_t', {
            sessionUpdate: 'usage_update',
            used: 100,
            size: 1000,
        });
        const after = AgentStatus.contextUpdate;
        assert.notStrictEqual(after, before);
        assert.strictEqual(after?.used, 100);
        assert.strictEqual(after?.size, 1000);
        assert.strictEqual(after?.cost, undefined);
    });
});

// ---------------------------------------------------------------------------
// Per-turn Usage forwarding (setUsage) and usage_update (setContextUpdate)
// wired through AgentStatus. Uses the same client/session harness as
// above; only asserts on AgentStatus state (no WS attached).
// ---------------------------------------------------------------------------

describe('ACPClient usage forwarding to AgentStatus', () => {
    let client: ACPClient;
    let mock: MockRpc;
    let logger: ACPLogger & { lines: string[] };

    before(() => {
        mock = makeMockRpc();
        logger = makeCaptureLogger();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger,
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
        (client as unknown as { sessions: Map<string, { accumulator: ReturnType<typeof makeAccumulator> }> }).sessions.set('ses_u', {
            accumulator: makeAccumulator(),
        });
    });

    it('session/prompt response with usage calls AgentStatus.setUsage', async () => {
        AgentStatus.clearUsage();
        const before = AgentStatus.usage;
        const session = client.getSession('ses_u')!;
        const promise = session.sendMessage('hello');
        // The mock captures the session/prompt request. Resolve it with
        // an ACP prompt response that includes a `usage` field.
        const promptCalls = mock.calls.filter((c) => c.method === 'session/prompt');
        assert.strictEqual(promptCalls.length, 1);
        const resolvers = mock.pendingResolvers.get('session/prompt')!;
        assert.strictEqual(resolvers.length, 1);
        resolvers[0].resolve({
            stopReason: 'end_turn',
            usage: {
                totalTokens: 12345,
                inputTokens: 8000,
                outputTokens: 2000,
                thoughtTokens: 500,
                cachedReadTokens: 1500,
                cachedWriteTokens: 0,
            },
        });
        await promise;
        const after = AgentStatus.usage;
        assert.notStrictEqual(after, before);
        // inputTokens = input + cache.read + cache.write (Kilo's ACP
        // `inputTokens` is the uncached-only portion; the CLI's "Context"
        // display sums all three — we match that).
        assert.strictEqual(after?.inputTokens, 8000 + 1500 + 0);
        // outputTokens = output + reasoning.
        assert.strictEqual(after?.outputTokens, 2000 + 500);
        assert.strictEqual(after?.cachedReadTokens, 1500);
        // Zero-valued sub-fields are stored as `undefined` (mirroring
        // Kilo's own `buildUsage` which uses `|| undefined`).
        assert.strictEqual(after?.cachedWriteTokens, undefined);
        // totalTokens is recomputed from the four cumulative sub-fields,
        // not taken from Kilo's per-turn total in the prompt response.
        // (= input-with-cache + output-with-reasoning + cachedRead + cachedWrite
        //   = (8000+1500+0) + (2000+500) + 1500 + 0
        //   = 13500)
        assert.strictEqual(after?.totalTokens, 8000 + 1500 + 0 + 2000 + 500 + 1500 + 0);
    });

    it('session/prompt response without usage leaves AgentStatus.usage unchanged', async () => {
        // Establish a known starting state.
        AgentStatus.clearUsage();
        AgentStatus.setUsage({ inputTokens: 1 });
        const before = AgentStatus.usage;
        const session = client.getSession('ses_u')!;
        const promise = session.sendMessage('hello again');
        const resolvers = mock.pendingResolvers.get('session/prompt')!;
        // Pick the last (still-pending) resolver.
        resolvers[resolvers.length - 1].resolve({ stopReason: 'end_turn' });
        await promise;
        const after = AgentStatus.usage;
        // setUsage short-circuits on identical values. The previous
        // test set a usage object whose inputTokens is now 1; this
        // test sends no usage at all so the singleton must not move.
        assert.strictEqual(after, before);
        assert.strictEqual(after?.inputTokens, 1);
    });
});

// ---------------------------------------------------------------------------
// Tool call logging format
// ---------------------------------------------------------------------------

describe('ACPClient tool call logging', () => {
    let client: ACPClient;
    let logger: ACPLogger & { lines: string[] };
    /** Captured writes to process.stdout (tool call lines + env block). */
    let stdoutLines: string[];
    let origStdoutWrite: typeof process.stdout.write;

    before(() => {
        logger = makeCaptureLogger();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger,
        });
        (client as unknown as { sessions: Map<string, { accumulator: { text: string; toolCalls: Map<string, unknown>; toolCallOrder: string[]; loggedToolCalls: Set<string>; todowriteCallIds: Set<string>; inFlightResolvers: null; stopReason: string; envBlockLogged: boolean } }> }).sessions.set('ses_log', {
            accumulator: {
                text: '',
                toolCalls: new Map(),
                toolCallOrder: [],
                loggedToolCalls: new Set(),
                todowriteCallIds: new Set(),
                inFlightResolvers: null,
                stopReason: 'end_turn',
                envBlockLogged: false,
            },
        });
        // Capture process.stdout.write so we can assert on tool-call
        // log lines (which now go directly to stdout, bypassing the
        // logger).
        stdoutLines = [];
        origStdoutWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array): boolean => {
            if (typeof chunk === 'string') stdoutLines.push(chunk);
            return true;
        }) as typeof process.stdout.write;
    });

    after(() => {
        process.stdout.write = origStdoutWrite;
    });

    /** Extract the `[READING] /path` etc. lines from a raw stdout capture. */
    function toolLines(): string[] {
        return stdoutLines
            .flatMap((s) => s.split('\n'))
            .filter((l) => /^\[(READING|BASH|GLOB|TODOS|WRITING|GREP|EDIT|TASK|TOOL)\]/.test(l));
    }

    it('logs [READING] for read tool with filePath, prefixed by <environment_details> block', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;  // reset for this test
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c1',
            status: 'completed',
            kind: 'read',
            rawInput: { filePath: '/repo/src/index.ts' },
        });
        // The full stdout should contain an <environment_details>
        // block followed by the [READING] line, with no [acp-client]
        // prefix.
        const full = stdoutLines.join('');
        assert.ok(full.includes('<environment_details>'), 'env block must precede tool line');
        assert.ok(full.includes('Current time:'), 'env block must include current time');
        assert.ok(full.includes('Working directory:'), 'env block must include working dir');
        assert.ok(full.includes('</environment_details>'), 'env block must be closed');
        assert.ok(full.includes('[READING] /repo/src/index.ts'), 'tool line must follow env block');
        assert.ok(!full.includes('[acp-client] [READING]'), 'tool line must NOT carry the [acp-client] prefix');
    });

    it('prompt sent to LLM is logged to stdout with <environment_details> block', () => {
        stdoutLines = [];
        // Drive the public logPromptToStdout method directly. We
        // can't easily call sendMessage from inside this describe
        // (no mock setup) so we exercise the formatter directly.
        client.logPromptToStdout('Hello, please help me with X.');
        const full = stdoutLines.join('');
        assert.ok(full.includes('<environment_details>'), 'env block must precede the prompt');
        assert.ok(full.includes('Current time:'), 'env block must include current time');
        assert.ok(full.includes('Working directory:'), 'env block must include working dir');
        assert.ok(full.includes('</environment_details>'), 'env block must be closed');
        assert.ok(full.includes('[user message sent to LLM]'), 'prompt must be labeled');
        assert.ok(full.includes('Hello, please help me with X.'), 'prompt text must appear in stdout');
    });

    it('subsequent tool calls in the same turn do NOT emit a second env block', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;  // reset for this test
        // First tool call — should emit env block + tool line
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 't1',
            status: 'completed',
            kind: 'read',
            rawInput: { filePath: '/repo/a.ts' },
        });
        // Second tool call in the same turn — should be tool line only
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 't2',
            status: 'completed',
            kind: 'read',
            rawInput: { filePath: '/repo/b.ts' },
        });
        const full = stdoutLines.join('');
        // The env block should appear exactly once across both tool
        // calls, not once per call.
        const envBlockCount = (full.match(/<environment_details>/g) ?? []).length;
        assert.strictEqual(envBlockCount, 1,
            `env block must appear once per turn, got ${envBlockCount} times`);
        // Both tool lines should still appear
        assert.ok(full.includes('[READING] /repo/a.ts'));
        assert.ok(full.includes('[READING] /repo/b.ts'));
    });

    it('logs [EXEC] for bash tool kind (kilo shell tool)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c2',
            status: 'completed',
            kind: 'bash',
            rawInput: { description: 'List files', command: 'ls -la' },
        });
        // Both `bash` and `execute` ToolKinds are formatted as
        // `[EXEC] <description>\n  - <command>`. The block is emitted
        // as a single write with an embedded newline. Find it in
        // the raw stdout capture.
        const full = stdoutLines.join('');
        assert.ok(full.includes('[EXEC] List files\n  - ls -la'),
            `[EXEC] multi-line block must be preserved; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('logs [EXEC] for execute tool kind (kilo shell tool)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_exec',
            status: 'completed',
            kind: 'execute',
            rawInput: { description: 'Run tests', command: 'npm test' },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[EXEC] Run tests\n  - npm test'),
            `[EXEC] line must show command; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('does NOT log execute tool with empty input (waits for tool_call_update)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        // Initial tool_call with empty input — should NOT log yet
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call',
            toolCallId: 'c_exec2',
            kind: 'execute',
            status: 'pending',
        });
        assert.strictEqual(stdoutLines.length, 0,
            'empty input must wait for tool_call_update');
        // tool_call_update with the real input — now log
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_exec2',
            status: 'completed',
            kind: 'execute',
            rawInput: { command: 'echo hi' },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[EXEC] \n  - echo hi'),
            `[EXEC] line must appear after tool_call_update; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('logs [SEARCH] for search tool kind (kilo repo_overview / context7)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_search1',
            status: 'completed',
            kind: 'search',
            rawInput: { repository: 'git@github.com:foo/bar.git', depth: 3 },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[SEARCH] repository=git@github.com:foo/bar.git depth=3'),
            `[SEARCH] line must show query fields; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('logs [SEARCH] with libraryId for context7-style queries', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_search2',
            status: 'completed',
            kind: 'search',
            rawInput: { libraryId: 'react' },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[SEARCH] libraryId=react'),
            `[SEARCH] must show libraryId; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('unknown tools get a [TOOL] <name> fallback with compact JSON input', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_other',
            status: 'completed',
            kind: 'other',
            rawInput: { foo: 'bar', n: 42 },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[TOOL] other: {"foo":"bar","n":42}'),
            `unknown tool must show input JSON; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('other-kind tool with a bare tool-id title logs under its real name (e.g. [TASK], [TOOL] skill)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        // Kilo maps `skill` to ACP kind `other`, but sets title to the
        // raw tool name on the pending call. We recover it for logging.
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_skill',
            status: 'completed',
            kind: 'other',
            title: 'skill',
            rawInput: { name: 'kilo-config' },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[TOOL] skill: {"name":"kilo-config"}'),
            `other-kind tool must log under real name from title; got: ${JSON.stringify(stdoutLines)}`);
        assert.ok(!full.includes('[TOOL] other:'),
            'must not fall back to the opaque "other" name when a real name is recoverable');
    });

    it('other-kind tool with a humanized title falls back to the generic name', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        // A title with spaces / capitals is NOT a bare tool id, so we
        // keep the generic `other` name rather than guessing.
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_humanized',
            status: 'completed',
            kind: 'other',
            title: 'Searching the web',
            rawInput: { query: 'x' },
        });
        const full = stdoutLines.join('');
        assert.ok(full.includes('[TOOL] other: {"query":"x"}'),
            `humanized title must fall back to other; got: ${JSON.stringify(stdoutLines)}`);
    });

    it('unknown tools with very long input get truncated to keep stdout readable', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        acc.envBlockLogged = false;
        const longString = 'x'.repeat(500);
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c_long',
            status: 'completed',
            kind: 'other',
            rawInput: { blob: longString },
        });
        // Extract the JSON substring from the [TOOL] line and check
        // that it's truncated (under 250 chars including `{"blob":"` + 200 x's + `…`).
        const toolLine = stdoutLines.find((l) => l.includes('[TOOL] other:'))!;
        const jsonStart = toolLine.indexOf('{');
        const jsonEnd = toolLine.lastIndexOf('}') + 1;
        const jsonSub = toolLine.slice(jsonStart, jsonEnd);
        assert.ok(jsonSub.length < 250, `tool line JSON must be truncated; got ${jsonSub.length} chars`);
        assert.ok(toolLine.includes('…'), 'truncated lines must end with ellipsis');
    });

    it('todowrite tool calls are NOT logged directly (forwarded as [TODOS]: via maybeForwardTodos)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call',
            toolCallId: 'c3',
            kind: 'todowrite',
            status: 'pending',
        });
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c3',
            status: 'completed',
            kind: 'todowrite',
            rawInput: { todos: [
                { content: 'First', status: 'completed' },
                { content: 'Second', status: 'pending' },
            ] },
        });
        assert.strictEqual(toolLines().length, 0, 'todowrite tool calls must not log directly');
    });

    it('does not log incomplete bash tool call (no command yet)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call',
            toolCallId: 'c4',
            kind: 'bash',
            status: 'pending',
        });
        assert.strictEqual(toolLines().length, 0);
    });

    it('logs a tool call only once (dedup by callID)', () => {
        stdoutLines = [];
        const acc = client.getAccumulator('ses_log')!;
        acc.toolCalls.clear();
        acc.toolCallOrder = [];
        acc.loggedToolCalls.clear();
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c5',
            status: 'in_progress',
            kind: 'read',
            rawInput: { filePath: '/repo/a.ts' },
        });
        client.handleSessionUpdate('ses_log', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c5',
            status: 'completed',
            kind: 'read',
            rawInput: { filePath: '/repo/a.ts' },
        });
        // Two update events for the same callID, but the tool line
        // should only appear once in stdout.
        assert.strictEqual(toolLines().length, 1);
    });
});



// ---------------------------------------------------------------------------
// Permission auto-grant
// ---------------------------------------------------------------------------

describe('ACPClient permission auto-grant', () => {
    let client: ACPClient;
    let mock: MockRpc;

    before(() => {
        mock = makeMockRpc();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger: makeCaptureLogger(),
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
    });

    it('handleRequestPermission auto-grants the first allow_* option', async () => {
        // Call the private request handler via the public session/update
        // method, which the agent uses to deliver permission requests.
        // We invoke the request handler directly since it's private.
        const handler = (client as unknown as { handleIncomingRequest: (m: string, p: unknown) => Promise<unknown> })
            .handleIncomingRequest.bind(client);
        const result = (await handler('session/request_permission', {
            sessionId: 'ses_p',
            toolCall: { toolCallId: 'c1', title: 'edit', status: 'pending' },
            options: [
                { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
                { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
            ],
        })) as { outcome: { outcome: string; optionId: string } };
        assert.strictEqual(result.outcome.outcome, 'selected');
        assert.strictEqual(result.outcome.optionId, 'allow_once');
    });

    it('falls back to the first option if no allow_* exists', async () => {
        const handler = (client as unknown as { handleIncomingRequest: (m: string, p: unknown) => Promise<unknown> })
            .handleIncomingRequest.bind(client);
        const result = (await handler('session/request_permission', {
            sessionId: 'ses_p',
            toolCall: { toolCallId: 'c1', title: 'edit', status: 'pending' },
            options: [
                { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
            ],
        })) as { outcome: { optionId: string } };
        assert.strictEqual(result.outcome.optionId, 'reject_once');
    });

    it('returns cancelled when no options are provided', async () => {
        const handler = (client as unknown as { handleIncomingRequest: (m: string, p: unknown) => Promise<unknown> })
            .handleIncomingRequest.bind(client);
        const result = (await handler('session/request_permission', {
            sessionId: 'ses_p',
            toolCall: { toolCallId: 'c1', title: 'edit', status: 'pending' },
            options: [],
        })) as { outcome: { outcome: string } };
        assert.strictEqual(result.outcome.outcome, 'cancelled');
    });

    it('fs/read_text_file request is rejected with method-not-supported', async () => {
        const handler = (client as unknown as { handleIncomingRequest: (m: string, p: unknown) => Promise<unknown> })
            .handleIncomingRequest.bind(client);
        await assert.rejects(
            () => handler('fs/read_text_file', { sessionId: 'ses_p', path: '/repo/x' }),
            /not supported/,
        );
    });
});

// ---------------------------------------------------------------------------
// ACPClient lifecycle
// ---------------------------------------------------------------------------

describe('ACPClient lifecycle', () => {
    it('exposes the ACPClient class as a library entry point', () => {
        assert.strictEqual(typeof ACPClient, 'function');
    });

    it('exposes the ACPSession class', () => {
        assert.strictEqual(typeof ACPSession, 'function');
    });

    it('exposes the JsonRpcClient class for stdio JSON-RPC 2.0', () => {
        assert.strictEqual(typeof JsonRpcClient, 'function');
    });
});

// ---------------------------------------------------------------------------
// JSON-RPC wire trace — verifies that the onRawMessage hook is called
// for both inbound and outbound messages with the correct direction.
// ---------------------------------------------------------------------------

describe('JsonRpcClient raw message tracing', () => {
    it('onRawMessage fires for outbound sendRequest / sendNotification', () => {
        const events: Array<{ dir: 'in' | 'out'; msg: unknown }> = [];
        // Build a minimal mock child process and inject our handlers.
        const proc = new EventEmitter() as unknown as Parameters<typeof JsonRpcClient>[0];
        // stdin/stdout/stderr need to be EventEmitters
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stdout = new EventEmitter();
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stderr = new EventEmitter();
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stdin = Object.assign(new EventEmitter(), {
            write: (_s: string, cb?: (e?: Error) => void) => cb?.(),
        });
        const client = new JsonRpcClient(proc, {
            onNotification: () => { /* ignore */ },
            onRequest: async () => ({}),
            onStderr: () => { /* ignore */ },
            onRawMessage: (dir, msg) => events.push({ dir, msg }),
        });
        // Outbound: sendRequest + sendNotification
        void client.sendRequest('initialize', { protocolVersion: 1 });
        client.sendNotification('initialized', {});
        // Outbound: response to an incoming request
        void client.sendRequest('ping', {});

        const outMsgs = events.filter((e) => e.dir === 'out').map((e) => e.msg) as Array<{ method: string; jsonrpc: string; id?: number }>;
        assert.strictEqual(outMsgs.length, 3);
        assert.strictEqual(outMsgs[0]!.method, 'initialize');
        assert.strictEqual(outMsgs[0]!.id, 1);
        assert.strictEqual(outMsgs[1]!.method, 'initialized');
        assert.ok(!('id' in outMsgs[1]!));
        assert.strictEqual(outMsgs[2]!.method, 'ping');
    });

    it('onRawMessage fires for inbound notification / response / request', () => {
        const events: Array<{ dir: 'in' | 'out'; msg: unknown }> = [];
        const stdoutEmitter = new EventEmitter();
        const proc = new EventEmitter() as unknown as Parameters<typeof JsonRpcClient>[0];
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stdout = stdoutEmitter;
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stderr = new EventEmitter();
        (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: (s: string, cb?: (e?: Error) => void) => void } }).stdin = Object.assign(new EventEmitter(), {
            write: (_s: string, cb?: (e?: Error) => void) => cb?.(),
        });
        const client = new JsonRpcClient(proc, {
            onNotification: () => { /* ignore */ },
            onRequest: async () => ({ ok: true }),
            onStderr: () => { /* ignore */ },
            onRawMessage: (dir, msg) => events.push({ dir, msg }),
        });
        // Send a request so there's a pending id to respond to
        void client.sendRequest('a-method', { foo: 1 });
        const pendingId = 1;
        // Inbound: notification, response, request (from agent)
        stdoutEmitter.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { x: 1 } }) + '\n'));
        stdoutEmitter.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: pendingId, result: { ok: true } }) + '\n'));
        stdoutEmitter.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'session/request_permission', params: {} }) + '\n'));

        const inMsgs = events.filter((e) => e.dir === 'in').map((e) => e.msg) as Array<{ method?: string; id?: number; result?: unknown }>;
        assert.strictEqual(inMsgs.length, 3, 'expected 3 inbound trace events');
        assert.strictEqual(inMsgs[0]!.method, 'session/update');
        assert.strictEqual(inMsgs[1]!.id, pendingId);
        assert.deepStrictEqual(inMsgs[1]!.result, { ok: true });
        assert.strictEqual(inMsgs[2]!.method, 'session/request_permission');
    });
});

// ---------------------------------------------------------------------------
// ACPSession.setMode
// ---------------------------------------------------------------------------

describe('ACPSession.setMode', () => {
    let client: ACPClient;
    let mock: MockRpc;

    before(() => {
        mock = makeMockRpc();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger: makeCaptureLogger(),
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
    });

    it('setMode sends session/set_mode and updates currentMode', async () => {
        mock.calls.length = 0;
        // Pre-register the session and create an ACPSession
        (client as unknown as { sessions: Map<string, unknown> }).sessions.set('ses_mode', { accumulator: null });
        const session = new ACPSession(client, 'ses_mode');
        session.currentMode = 'plan';

        // Resolve the pending sendRequest for session/set_mode
        const pending = mock.pendingResolvers.get('session/set_mode');
        // Replace the mock sendRequest so the promise resolves immediately
        const origSend = mock.sendRequest;
        mock.sendRequest = async <T>(method: string, params?: unknown): Promise<T> => {
            mock.calls.push({ method, params, type: 'request' });
            if (method === 'session/set_mode') {
                return undefined as T;
            }
            return new Promise<T>(() => { /* hang — not used here */ });
        };

        await session.setMode('code');
        assert.strictEqual(session.currentMode, 'code');
        const setCall = mock.calls.find((c) => c.method === 'session/set_mode');
        assert.ok(setCall, 'expected session/set_mode call');
        const params = setCall!.params as { sessionId: string; modeId: string };
        assert.strictEqual(params.sessionId, 'ses_mode');
        assert.strictEqual(params.modeId, 'code');
        void pending;
        void origSend;
    });
});

// ---------------------------------------------------------------------------
// ACPSession.setModel
// ---------------------------------------------------------------------------

describe('ACPSession.setModel', () => {
    let client: ACPClient;
    let mock: MockRpc;

    before(() => {
        mock = makeMockRpc();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger: makeCaptureLogger(),
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
    });

    it('setModel sends session/set_config_option with configId=model', async () => {
        mock.calls.length = 0;
        (client as unknown as { sessions: Map<string, unknown> }).sessions.set('ses_model', { accumulator: null });
        const session = new ACPSession(client, 'ses_model');

        // Replace the mock sendRequest so it resolves immediately
        // and we can capture the params sent for set_config_option.
        const origSend = mock.sendRequest;
        mock.sendRequest = async <T>(method: string, params?: unknown): Promise<T> => {
            mock.calls.push({ method, params, type: 'request' });
            if (method === 'session/set_config_option') {
                return undefined as T;
            }
            return new Promise<T>(() => { /* hang — not used here */ });
        };

        await session.setModel('minimax/MiniMax-M2.7');
        const setCall = mock.calls.find((c) => c.method === 'session/set_config_option');
        assert.ok(setCall, 'expected session/set_config_option call');
        const params = setCall!.params as { sessionId: string; configId: string; value: string };
        assert.strictEqual(params.sessionId, 'ses_model');
        assert.strictEqual(params.configId, 'model');
        assert.strictEqual(params.value, 'minimax/MiniMax-M2.7');
        void origSend;
    });
});

// ---------------------------------------------------------------------------
// Regression: with no turnInactivityTimeoutMs configured (default 0), sendPrompt
// has no client-side wall-clock cap and resolves only when the underlying
// session/prompt response arrives. The opt-in inactivity timer is covered
// separately below.
// ---------------------------------------------------------------------------

describe('ACPClient.sendPrompt no client-side timeout (timer disabled)', () => {
    let client: ACPClient;
    let mock: MockRpc;
    let logger: ACPLogger & { lines: string[] };

    before(() => {
        mock = makeMockRpc();
        logger = makeCaptureLogger();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger,
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
        (client as unknown as { sessions: Map<string, { accumulator: ReturnType<typeof makeAccumulator> }> }).sessions.set('ses_nocap', {
            accumulator: {
                text: '',
                toolCalls: new Map(),
                toolCallOrder: [],
                loggedToolCalls: new Set(),
                todowriteCallIds: new Set(),
                inFlightResolvers: null,
                stopReason: 'end_turn',
                envBlockLogged: false,
            },
        });
    });

    after(() => {
        client.shutdown();
    });

    it('resolves only when the underlying session/prompt response arrives, not on a wall-clock cap', async () => {
        const sendPromise = (client as unknown as {
            sendPrompt: (id: string, prompt: unknown, opts?: unknown) => Promise<unknown>;
        }).sendPrompt('ses_nocap', [{ type: 'text', text: 'hi' }], {});

        // The sendPrompt must NOT reject after 30 minutes of wall-clock time.
        // We simulate "long time" by waiting 50 ms (a tiny stand-in — the
        // assertion we care about is that the client does not have a
        // setTimeout-based reject path at all). Then we resolve the
        // underlying JSON-RPC response and assert the promise resolves.
        await new Promise((r) => setTimeout(r, 50));

        const pending = mock.pendingResolvers.get('session/prompt');
        assert.ok(pending && pending.length === 1, 'session/prompt request should be in flight');
        pending![0]!.resolve({ stopReason: 'end_turn' });

        const response = await sendPromise as { text: string; stopReason: string };
        assert.strictEqual(response.stopReason, 'end_turn');
    });
});

function makeAccumulator() {
    return {
        text: '',
        toolCalls: new Map() as Map<string, unknown>,
        toolCallOrder: [] as string[],
        loggedToolCalls: new Set<string>(),
        inFlightResolvers: null as null | Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }>,
        stopReason: 'end_turn',
    };
}

function fullAccumulator() {
    return {
        text: '',
        toolCalls: new Map(),
        toolCallOrder: [],
        loggedToolCalls: new Set(),
        todowriteCallIds: new Set(),
        inFlightResolvers: null,
        stopReason: 'end_turn',
        envBlockLogged: false,
    };
}

// ---------------------------------------------------------------------------
// Recovery: kilo acp sometimes reports session/update for a session ID that
// doesn't match the one session/new returned. While a single turn is in
// flight, the client must adopt (alias) that id onto the active turn instead
// of dropping the update — otherwise the accumulator never fills and the turn
// hangs until the orchestrator's inactivity timer fires.
// ---------------------------------------------------------------------------

describe('ACPClient session/update mismatched-session recovery', () => {
    let client: ACPClient;
    let mock: MockRpc;
    let logger: ACPLogger & { lines: string[] };

    before(() => {
        mock = makeMockRpc();
        logger = makeCaptureLogger();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            logger,
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
        (client as unknown as { sessions: Map<string, unknown> }).sessions.set('ses_local', {
            accumulator: fullAccumulator(),
        });
    });

    after(() => { client.shutdown(); });

    it('aliases an unknown session id onto the in-flight turn and assembles the response', async () => {
        const sendPromise = (client as unknown as {
            sendPrompt: (id: string, prompt: unknown, opts?: unknown) => Promise<unknown>;
        }).sendPrompt('ses_local', [{ type: 'text', text: 'hi' }], {});

        // The agent reports updates under a DIFFERENT session id.
        client.handleSessionUpdate('ses_agent_mismatch', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'recovered ' },
        });
        client.handleSessionUpdate('ses_agent_mismatch', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'output' },
        });

        const pending = mock.pendingResolvers.get('session/prompt');
        assert.ok(pending && pending.length === 1, 'session/prompt should be in flight');
        pending![0]!.resolve({ stopReason: 'end_turn' });

        const response = await sendPromise as { text: string; stopReason: string };
        assert.strictEqual(response.text, 'recovered output');
        assert.ok(
            logger.lines.some((l) => l.includes('aliasing onto active turn ses_local')),
            'expected an aliasing log line',
        );
    });

    it('still drops an unknown-session update when no turn is in flight', () => {
        logger.lines.length = 0;
        client.handleSessionUpdate('ses_totally_unknown', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'ignored' },
        });
        assert.ok(
            logger.lines.some((l) => l.includes('unknown session ses_totally_unknown') && !l.includes('aliasing')),
            'expected a plain drop log line with no aliasing',
        );
    });
});

// ---------------------------------------------------------------------------
// Safety net: when turnInactivityTimeoutMs is configured, a turn that receives
// no session/update activity must reject locally instead of hanging forever.
// ---------------------------------------------------------------------------

describe('ACPClient.sendPrompt inactivity timeout (timer enabled)', () => {
    let client: ACPClient;
    let mock: MockRpc;

    before(() => {
        mock = makeMockRpc();
        client = new (ACPClient as unknown as new (opts: unknown) => ACPClient)({
            cwd: '/repo',
            kiloBinary: 'kilo',
            initTimeoutMs: 1000,
            turnInactivityTimeoutMs: 40,
            logger: makeCaptureLogger(),
        });
        client.setRpcForTesting(mock as unknown as JsonRpcClient);
        (client as unknown as { sessions: Map<string, unknown> }).sessions.set('ses_to', {
            accumulator: fullAccumulator(),
        });
    });

    after(() => { client.shutdown(); });

    it('rejects the turn when no session/update arrives within the timeout', async () => {
        const sendPromise = (client as unknown as {
            sendPrompt: (id: string, prompt: unknown, opts?: unknown) => Promise<unknown>;
        }).sendPrompt('ses_to', [{ type: 'text', text: 'hi' }], {});

        await assert.rejects(
            sendPromise as Promise<unknown>,
            /inactivity timeout/,
            'turn should reject on inactivity',
        );
        // It should have sent a best-effort session/cancel notification.
        assert.ok(
            mock.calls.some((c) => c.method === 'session/cancel' && c.type === 'notification'),
            'expected a session/cancel notification',
        );
    });

    it('does NOT time out while session/update activity keeps arriving', async () => {
        (client as unknown as { sessions: Map<string, unknown> }).sessions.set('ses_active', {
            accumulator: fullAccumulator(),
        });
        const sendPromise = (client as unknown as {
            sendPrompt: (id: string, prompt: unknown, opts?: unknown) => Promise<unknown>;
        }).sendPrompt('ses_active', [{ type: 'text', text: 'hi' }], {});

        // Keep the turn alive past the 40ms window with periodic activity.
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 20));
            client.handleSessionUpdate('ses_active', {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'x' },
            });
        }

        const pending = mock.pendingResolvers.get('session/prompt');
        assert.ok(pending && pending.length >= 1, 'session/prompt should still be in flight');
        pending![pending!.length - 1]!.resolve({ stopReason: 'end_turn' });

        const response = await sendPromise as { stopReason: string };
        assert.strictEqual(response.stopReason, 'end_turn');
    });
});
