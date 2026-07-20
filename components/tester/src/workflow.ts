import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config.js';
import { messenger } from './messenger.js';
import { AgentStatus } from './agent-status.js';
import { runCommand } from './shell.js';
import { mountAndReset } from './repo.js';
import { writeKiloJson } from './kilojson.js';
import { readVerdict } from './verifier.js';
import { ACPClient, type ACPSession } from './acp-client.js';
import type { PlanEntry } from './acp-schema.js';

const PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');

export interface PlanTask {
    id: string;
    task: string;
    verdict?: 'pass' | 'fail' | 'pending';
    summary?: string;
}

export interface TestPlan {
    tasks: PlanTask[];
}

function tryParsePlan(raw: string): TestPlan | null {
    if (!raw || raw.trim() === '') return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks)) {
            if (parsed.tasks.length > 0 && typeof parsed.tasks[0] === 'object') {
                return parsed as TestPlan;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

interface SetupResult {
    ok: boolean;
    step: 'clone' | 'kilo_config' | 'setup_sh';
    error: string;
}

interface StageResult {
    ok: boolean;
    sessionId: string;
    error: string;
    entriesTotal?: number;
}

function renderTemplate(file: string, subs: Record<string, string>): string {
    let body = '';
    try {
        body = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf-8');
    } catch (err: any) {
        throw new Error(`could not read prompts/${file}: ${err.message}`);
    }
    for (const [k, v] of Object.entries(subs)) {
        body = body.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return body;
}

function wipeDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    fs.mkdirSync(dir, { recursive: true });
}

function wipeStageArtifacts(): void {
    wipeDir(CONFIG.VERDICTS_DIR);
    // Remove any stale final-verdict file (current + legacy paths) so a
    // leftover from a previous run can't be mistaken for this run's verdict.
    for (const f of [CONFIG.VERDICT_PATH, '/tmp/verdict.json', '/tmp/VERDICT', '/tmp/VERDICT.json']) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
}

function listVerdictFiles(): string[] {
    if (!fs.existsSync(CONFIG.VERDICTS_DIR)) return [];
    return fs
        .readdirSync(CONFIG.VERDICTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort();
}

function verdictIdFromFile(verdictFile: string): string {
    return verdictFile.replace(/\.json$/, '');
}

function validateVerdictFile(file: string): { ok: boolean; reason: string } {
    const full = path.join(CONFIG.VERDICTS_DIR, file);
    let raw: string;
    try {
        raw = fs.readFileSync(full, 'utf-8');
    } catch (err: any) {
        return { ok: false, reason: `could not read ${full}: ${err.message}` };
    }
    let v: any;
    try {
        v = JSON.parse(raw);
    } catch (err: any) {
        return { ok: false, reason: `invalid JSON in ${full}: ${err.message}` };
    }
    const expectedId = verdictIdFromFile(file);
    if (typeof v?.id !== 'string' || v.id !== expectedId) {
        return { ok: false, reason: `verdict id mismatch in ${full} (expected "${expectedId}")` };
    }
    if (v?.verdict !== 'pass' && v?.verdict !== 'fail') {
        return { ok: false, reason: `invalid verdict in ${full} (must be "pass" or "fail")` };
    }
    if (typeof v?.summary !== 'string' || v.summary.length === 0) {
        return { ok: false, reason: `missing/empty summary in ${full}` };
    }
    return { ok: true, reason: '' };
}

function normalizeText(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

export class WorkflowEngine {
    private client: ACPClient | null = null;
    private testPlan: TestPlan | null = null;

    public async execute(): Promise<void> {
        let success = false;
        try {
            AgentStatus.set('setup', 1, 1);
            await this.diagnostics();

            const setup = await this.runSetup();
            if (!setup.ok) {
                await messenger.sendFinish('error', {
                    step: setup.step,
                    error: setup.error,
                    verdict: 'fail',
                    passed_tests: this.testPlan ? JSON.stringify(this.testPlan) : CONFIG.PASSED_TESTS,
                });
                return;
            }

            wipeStageArtifacts();

            // Stage 1 — Test: a plan-mode session subdivides the plan, then
            // each entry runs in its own fresh code-mode session. runTest
            // manages per-entry AgentStatus progress internally.
            const test = await this.runTest();
            const verdictFiles = listVerdictFiles();
            if (!test.ok || verdictFiles.length === 0) {
                await messenger.sendFinish('error', {
                    step: 'test',
                    error: test.ok
                        ? `test session produced no verdict files in ${CONFIG.VERDICTS_DIR}`
                        : test.error,
                    verdict: 'fail',
                    session_id: test.sessionId,
                    passed_tests: this.testPlan ? JSON.stringify(this.testPlan) : CONFIG.PASSED_TESTS,
                });
                return;
            }

            // Validate every per-entry verdict file before aggregating.
            for (const file of verdictFiles) {
                const v = validateVerdictFile(file);
                if (!v.ok) {
                    await messenger.sendFinish('error', {
                        step: 'test',
                        error: v.reason,
                        verdict: 'fail',
                        session_id: test.sessionId,
                        passed_tests: this.testPlan ? JSON.stringify(this.testPlan) : CONFIG.PASSED_TESTS,
                    });
                    return;
                }
            }

            const entriesExecuted = verdictFiles.length;
            const entriesTotal = test.entriesTotal || entriesExecuted;
            console.log(`[workflow] Test produced ${entriesExecuted} per-entry verdict file(s).`);

            // Stage 2 — Verdict. The verdict agent writes the final verdict to
            // CONFIG.VERDICT_PATH (/tmp/verdict.json); runVerdict reads it back.
            AgentStatus.set('verdict', 1, 1);
            const verdict = await this.runVerdict(entriesExecuted, entriesTotal);

            // Protocol status is about whether the RUN completed cleanly, not
            // about pass/fail. A `fail` verdict is still a successful run (the
            // test executed and produced a verdict) — the pass/fail outcome
            // travels in the `verdict`/`summary` payload fields. Only an
            // actual failure to PRODUCE a verdict (verdict.ok === false) is an
            // error at the protocol level.
            const status: 'success' | 'error' = verdict.ok ? 'success' : 'error';
            console.log(`[workflow] Verdict stage complete: verdict=${verdict.verdict} (run ${status}).`);
            await messenger.sendFinish(status, {
                verdict: verdict.verdict,
                summary: verdict.summary,
                session_id: verdict.sessionId,
                entries_executed: entriesExecuted,
                entries_total: entriesTotal,
                passed_tests: this.testPlan ? JSON.stringify(this.testPlan) : CONFIG.PASSED_TESTS,
            });
            // The run reached a terminal verdict; from the process's point of
            // view this is a clean exit regardless of pass/fail.
            success = verdict.ok;
        } catch (err: any) {
            console.error(`[workflow] fatal: ${err.message}`);
            await messenger.sendFinish('error', {
                error: err.message,
                verdict: 'fail',
                step: 'workflow',
                passed_tests: this.testPlan ? JSON.stringify(this.testPlan) : CONFIG.PASSED_TESTS,
            });
        } finally {
            // sendFinish above already awaited the socket flush, so the
            // orchestrator has the terminal frame before we exit. A short
            // grace delay lets any trailing log frames drain, then exit.
            setTimeout(() => process.exit(success ? 0 : 1), 250);
        }
    }

    private async diagnostics(): Promise<void> {
        if (!CONFIG.REPO_URL) throw new Error('REPO_URL not provided');
        if (!CONFIG.BACKEND_MODEL) throw new Error('execution_model is required');
        if (!CONFIG.TEST_PLAN) throw new Error('test_plan is required');

        const which = await runCommand('which', ['kilo'], '/');
        if (which.code !== 0) throw new Error('kilo CLI not found in PATH');

        // The controller is a stdio MCP server spawned on demand by kilo
        // acp via `session/new mcpServers` (see runTest()). There is no
        // global readiness probe to run here.
    }

    public async runSetup(): Promise<SetupResult> {
        try {
            await mountAndReset();
        } catch (err: any) {
            return { ok: false, step: 'clone', error: err.message };
        }
        try {
            writeKiloJson();
        } catch (err: any) {
            return { ok: false, step: 'kilo_config', error: err.message };
        }

        const setupSh = path.join(CONFIG.REPO_PATH, 'setup.sh');
        if (fs.existsSync(setupSh)) {
            console.log(`[setup] running ${setupSh}`);
            try {
                const r = await runCommand('bash', [setupSh], CONFIG.REPO_PATH);
                if (r.code !== 0) {
                    return { ok: false, step: 'setup_sh', error: r.output.slice(-4000) };
                }
            } catch (err: any) {
                return { ok: false, step: 'setup_sh', error: err.message };
            }
        }
        return { ok: true, step: 'clone', error: '' };
    }

    private async ensureClient(): Promise<ACPClient> {
        if (this.client) return this.client;
        this.client = await ACPClient.init({
            cwd: CONFIG.REPO_PATH,
            turnInactivityTimeoutMs: CONFIG.ACP_TURN_INACTIVITY_TIMEOUT > 0
                ? CONFIG.ACP_TURN_INACTIVITY_TIMEOUT * 1000
                : 0,
        });
        return this.client;
    }

    private async createSession(mode: 'plan' | 'code' = 'code'): Promise<ACPSession> {
        const client = await this.ensureClient();
        return await client.createSession({
            model: CONFIG.BACKEND_MODEL,
            mode,
            mcpServers: this.controllerMcpServers(),
        });
    }

    /**
     * Build the MCP server entry that attaches the OpenVelo GUI
     * controller to the ACP session. The controller is spawned by
     * entrypoint.sh before the workflow starts, bound to
     * http://${MCP_HOST}:${MCP_PORT}/ (streamable-http by default;
     * `/sse` when MCP_TRANSPORT=sse). kilo acp attaches to it via the
     * remote HTTP/SSE shape of `session/new mcpServers`. In debug mode
     * the same endpoint can be driven directly with curl / wscat /
     * MCP Inspector.
     *
     * If MCP_TRANSPORT=stdio, fall back to the per-session stdio spawn
     * (kilo acp launches the python process itself).
     */
    private controllerMcpServers(): Array<Record<string, unknown>> {
        const servers: Array<Record<string, unknown>> = [];

        if (CONFIG.MCP_TRANSPORT === 'stdio') {
            const controllerPath = path.resolve(process.cwd(), 'mcp', 'mcp.py');
            servers.push({
                name: 'controller',
                command: 'python3',
                args: [controllerPath],
                env: [
                    { name: 'DISPLAY', value: CONFIG.DISPLAY },
                    { name: 'XDG_RUNTIME_DIR', value: process.env.XDG_RUNTIME_DIR || '/run/user/0' },
                    { name: 'DBUS_SESSION_BUS_ADDRESS', value: process.env.DBUS_SESSION_BUS_ADDRESS || '' },
                    { name: 'AT_SPI_BUS_ADDRESS', value: process.env.AT_SPI_BUS_ADDRESS || `unix:path=${process.env.XDG_RUNTIME_DIR || '/run/user/0'}/at-spi/bus` },
                    { name: 'PATH', value: process.env.PATH || '' },
                ],
            });
        } else {
            // Remote HTTP/SSE — entrypoint.sh owns the server process. kilo
            // acp's `session/new mcpServers` schema only accepts the wire
            // `type` values "http" (Streamable HTTP) or "sse"; map the
            // internal 'streamable-http' transport name onto "http".
            const isSse = CONFIG.MCP_TRANSPORT === 'sse';
            const url = `http://${CONFIG.MCP_HOST}:${CONFIG.MCP_PORT}/${isSse ? 'sse' : 'mcp'}`;
            servers.push({
                name: 'controller',
                url,
                type: isSse ? 'sse' : 'http',
                headers: [],
            });
        }

        // Playwright MCP Server spawned additionally via npx
        servers.push({
            name: 'playwright',
            command: 'npx',
            args: ['-y', '@playwright/mcp', `--viewport-size=${CONFIG.SCREEN_W}x${CONFIG.SCREEN_H}`],
            env: [
                { name: 'DISPLAY', value: CONFIG.DISPLAY },
                { name: 'PATH', value: process.env.PATH || '' },
            ],
        });

        return servers;
    }

    // ---------------- Stage 1: Test -------------------------------------
    // Two sub-stages:
    //   1a. A dedicated PLAN-mode session subdivides the test plan into
    //       ordered entries (via todowrite) and does nothing else.
    //   1b. Each entry is then executed in its OWN fresh code-mode session,
    //       one at a time, fully isolated (verdict files are the only
    //       cross-entry artifact). The live GUI is the shared runtime state.
    private async runTest(): Promise<StageResult> {
        // Ensure /tmp/tests is clean and exists
        const testFilesDir = '/tmp/tests';
        wipeDir(testFilesDir);

        let lastSessionId = '';

        // Try parsing the plan passed into the container
        const passedPlan = tryParsePlan(CONFIG.PASSED_TESTS);
        if (passedPlan) {
            console.log('[test] Valid plan passed in CONFIG.PASSED_TESTS. Skipping planning stage.');
            this.testPlan = passedPlan;
            // Write it to /tmp/tests/plan.json
            fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(this.testPlan, null, 2), 'utf-8');
        } else {
            // --- 1a. Task Generation / Planning session -----------------------
            AgentStatus.set('planning', 1, 1);
            // Spawn as a 'code'-mode session so the agent can write files to the filesystem.
            const planSession = await this.createSession('code');
            lastSessionId = planSession.id;
            console.log(`[test] starting Task Generation session ${planSession.id} (MCP=${CONFIG.MCP_TRANSPORT})`);

            const planPrompt = renderTemplate('test_plan.md', {
                TEST_PLAN: CONFIG.TEST_PLAN,
                REPO_PATH: CONFIG.REPO_PATH,
                PASSED_TESTS: CONFIG.PASSED_TESTS || '[]',
            });
            try {
                await planSession.sendMessage(planPrompt);
            } catch (err: any) {
                await this.safeClose(planSession);
                return { ok: false, sessionId: planSession.id, error: `task generation sendMessage failed: ${err.message}` };
            }

            await this.safeClose(planSession);

            // Read the generated plan.json file from /tmp/tests/plan.json
            const planPath = path.join(testFilesDir, 'plan.json');
            if (fs.existsSync(planPath)) {
                try {
                    const raw = fs.readFileSync(planPath, 'utf-8');
                    this.testPlan = JSON.parse(raw) as TestPlan;
                } catch (err: any) {
                    console.error(`[test] failed to parse generated plan.json: ${err.message}`);
                }
            }
        }

        // Fallback if no valid plan was generated or parsed
        if (!this.testPlan || !Array.isArray(this.testPlan.tasks) || this.testPlan.tasks.length === 0) {
            console.warn('[test] task generation produced no valid plan.json; ' +
                'falling back to executing the entire test plan as a single task.');
            this.testPlan = {
                tasks: [
                    {
                        id: '001',
                        task: CONFIG.TEST_PLAN,
                        verdict: 'pending'
                    }
                ]
            };
            fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(this.testPlan, null, 2), 'utf-8');
        }

        const testPlan = this.testPlan;

        console.log(`[test] test plan has ${testPlan.tasks.length} task(s).`);

        // Restore verdict files for already-passed tasks so the Verdict Stage has them
        for (const t of testPlan.tasks) {
            if (t && t.verdict === 'pass') {
                const p = path.join(CONFIG.VERDICTS_DIR, `${t.id}.json`);
                fs.writeFileSync(p, JSON.stringify({
                    id: t.id,
                    verdict: 'pass',
                    summary: t.summary || 'Already passed in previous run.'
                }, null, 2), 'utf-8');
            }
        }

        // --- 1b. Per-task execution sessions -----------------------------
        // Find the starting task index: first task that is not 'pass' (could be 'fail' or 'pending')
        const startIndex = testPlan.tasks.findIndex(t => t && t.verdict !== 'pass');
        if (startIndex === -1) {
            console.log('[test] All tasks in plan have already passed. Skipping execution.');
            // Set progress to 100%
            AgentStatus.set('testing', testPlan.tasks.length, testPlan.tasks.length);
            
            // Prepare the plan entries for AgentStatus (so operator visibility works)
            const entries: PlanEntry[] = testPlan.tasks.map((t) => ({
                content: t ? t.task : '',
                priority: 'medium',
                status: 'completed',
            }));
            AgentStatus.setPlanEntries(entries);

            return {
                ok: true,
                sessionId: lastSessionId,
                error: '',
                entriesTotal: testPlan.tasks.length,
            };
        }

        const startingTask = testPlan.tasks[startIndex];
        if (!startingTask) {
            return {
                ok: false,
                sessionId: lastSessionId,
                error: `failed to find starting task at index ${startIndex}`,
            };
        }

        console.log(`[test] Resuming test plan from task index ${startIndex + 1} (task id ${startingTask.id}).`);
        AgentStatus.set('testing', startIndex, testPlan.tasks.length);

        // Prepare the plan entries for AgentStatus (so operator visibility works)
        const entries: PlanEntry[] = testPlan.tasks.map((t) => ({
            content: t ? t.task : '',
            priority: 'medium',
            status: t && t.verdict === 'pass' ? 'completed' : 'pending',
        }));

        for (let i = startIndex; i < testPlan.tasks.length; i++) {
            const t = testPlan.tasks[i];
            if (!t) continue;
            const baseName = t.id;
            AgentStatus.set('testing', i + 1, testPlan.tasks.length);

            const verdictFile = path.join(CONFIG.VERDICTS_DIR, `${baseName}.json`);
            // Clean up any stale verdict file for this specific task before starting its session
            try { fs.unlinkSync(verdictFile); } catch { /* ignore */ }

            const entryPrompt = renderTemplate('test_system.md', {
                TEST_PLAN: CONFIG.TEST_PLAN,
                VERDICTS_DIR: CONFIG.VERDICTS_DIR,
                REPO_PATH: CONFIG.REPO_PATH,
                ENTRY_INDEX: baseName,
                ENTRY_TOTAL: String(testPlan.tasks.length),
                ENTRY_CONTENT: JSON.stringify({ id: t.id, task: t.task }, null, 2),
                PLAN_STATE: JSON.stringify(testPlan, null, 2),
            });

            const session = await this.createSession('code');
            lastSessionId = session.id;

            // Re-publish the captured plan to the live panel with the current entry marked in_progress.
            AgentStatus.setPlanEntries(entries.map((e, j): PlanEntry => ({
                content: e.content,
                priority: e.priority,
                status: j < i ? 'completed' : j === i ? 'in_progress' : 'pending',
            })));

            console.log(`[test] task ${t.id} (${i + 1}/${testPlan.tasks.length}): fresh session ${session.id}`);
            try {
                await session.sendMessage(entryPrompt);
            } catch (err: any) {
                await this.safeClose(session);
                t.verdict = 'fail';
                t.summary = `Session send message failed: ${err.message}`;
                // Save current state of plan.json to disk before returning
                fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(testPlan, null, 2), 'utf-8');
                return {
                    ok: false,
                    sessionId: session.id,
                    error: `task ${t.id} sendMessage failed: ${err.message}`,
                };
            }
            await this.safeClose(session);

            if (!fs.existsSync(verdictFile)) {
                t.verdict = 'fail';
                t.summary = `Task produced no verdict file at ${verdictFile}`;
                // Save current state of plan.json to disk before returning
                fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(testPlan, null, 2), 'utf-8');
                return {
                    ok: false,
                    sessionId: session.id,
                    error: `task ${t.id} produced no verdict file at ${verdictFile}`,
                };
            }

            try {
                const raw = fs.readFileSync(verdictFile, 'utf-8');
                const v = JSON.parse(raw) as { verdict?: 'pass' | 'fail'; summary?: string };
                t.verdict = v?.verdict || 'fail';
                t.summary = v?.summary || '';

                if (t.verdict === 'fail') {
                    console.log(`[workflow] Task ${t.id} failed. Aborting subsequent test tasks.`);
                    // Also update the in-memory/on-disk plan.json so it matches the current state
                    fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(testPlan, null, 2), 'utf-8');
                    break;
                } else {
                    const entryObj = entries[i];
                    if (entryObj) {
                        entryObj.status = 'completed';
                    }
                }
            } catch (err: any) {
                t.verdict = 'fail';
                t.summary = `Task produced invalid verdict JSON: ${err.message}`;
                // Save current state of plan.json to disk before returning
                fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(testPlan, null, 2), 'utf-8');
                return {
                    ok: false,
                    sessionId: session.id,
                    error: `task ${t.id} produced invalid verdict JSON: ${err.message}`,
                };
            }
        }

        // Save final/current state of plan.json to disk
        fs.writeFileSync(path.join(testFilesDir, 'plan.json'), JSON.stringify(testPlan, null, 2), 'utf-8');

        return {
            ok: true,
            sessionId: lastSessionId,
            error: '',
            entriesTotal: testPlan.tasks.length,
        };
    }

    /** Best-effort session close that never throws. */
    private async safeClose(session: ACPSession): Promise<void> {
        try {
            await session.close();
        } catch (err: any) {
            console.error(`[test] session ${session.id} close failed: ${err.message}`);
        }
    }

    /**
     * Deterministically aggregate the per-entry verdict files into an overall
     * verdict, WITHOUT the LLM. Used as a fallback when the verdict agent
     * fails to write a usable /tmp/verdict.json, so the run always reaches a
     * terminal verdict instead of being reported as a crash.
     */
    private aggregateVerdictFromFiles(): { verdict: 'pass' | 'fail'; summary: string } {
        const files = listVerdictFiles();
        if (files.length === 0) {
            return { verdict: 'fail', summary: 'No plan entries were executed.' };
        }
        let failedSummary = '';
        let anyFail = false;
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(CONFIG.VERDICTS_DIR, file), 'utf-8');
                const v = JSON.parse(raw) as { verdict?: string; summary?: string };
                const verdict = (typeof v.verdict === 'string' ? v.verdict : '').toLowerCase();
                const summary = typeof v.summary === 'string' ? v.summary : '';
                if (verdict === 'fail') {
                    anyFail = true;
                    failedSummary = summary;
                    break;
                }
            } catch (err: any) {
                anyFail = true;
                failedSummary = `Could not read/parse verdict (${err.message}).`;
                break;
            }
        }
        if (anyFail) {
            return { verdict: 'fail', summary: failedSummary };
        }
        return { verdict: 'pass', summary: 'All entries passed.' };
    }

    // ---------------- Stage 2: Verdict ----------------------------------
    private async runVerdict(entriesExecuted: number, entriesTotal: number) {
        const subs: Record<string, string> = {
            VERDICTS_DIR: CONFIG.VERDICTS_DIR,
            VERDICT_PATH: CONFIG.VERDICT_PATH,
            ENTRIES_EXECUTED: String(entriesExecuted),
            ENTRIES_TOTAL: String(entriesTotal),
        };
        const sysPrompt = renderTemplate('verdict_system.md', subs);

        try { fs.unlinkSync(CONFIG.VERDICT_PATH); } catch { /* ignore */ }

        const session = await this.createSession('code');
        console.log(`[verdict] starting ACP session ${session.id}`);
        let sendErr = '';
        try {
            await session.sendMessage(sysPrompt);
        } catch (err: any) {
            sendErr = err.message;
            console.error(`[verdict] sendMessage failed: ${err.message}`);
        }

        // Preferred path: the agent wrote /tmp/verdict.json.
        const v = readVerdict();
        if (v) {
            return {
                ok: true,
                verdict: v.verdict,
                summary: v.summary,
                sessionId: session.id,
            };
        }

        // Fallback: the agent didn't produce a usable verdict file. Rather
        // than fail the run (which the orchestrator would treat as a crash),
        // aggregate the already-validated per-entry verdict files ourselves.
        console.warn('[verdict] no usable /tmp/verdict.json from agent; ' +
            'aggregating per-entry verdicts deterministically.' +
            (sendErr ? ` (sendMessage error: ${sendErr})` : ''));
        const agg = this.aggregateVerdictFromFiles();
        // Persist it so the artifact exists for inspection.
        try {
            fs.writeFileSync(CONFIG.VERDICT_PATH, JSON.stringify(agg, null, 2), 'utf-8');
        } catch { /* ignore */ }
        return {
            ok: true,
            verdict: agg.verdict,
            summary: agg.summary,
            sessionId: session.id,
        };
    }
}