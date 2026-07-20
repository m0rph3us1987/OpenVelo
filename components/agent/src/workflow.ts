import * as fs from 'fs';
import * as path from 'path';
import { CONFIG, toAgentPath } from './config.js';
import { messenger } from './messenger.js';
import { AgentStatus, type Stage } from './agent-status.js';
import { runCommand, isWatchMode, stripWatchFlags } from './shell.js';
import { createAndMergePR as createAdoPR } from './ado.js';
import { createAndMergePR as createGithubPR } from './github.js';
import { createAndMergePR as createGiteaPR } from './gitea.js';
import { createAndMergePR as createBitbucketPR } from './bitbucket.js';
import { dotnetSetup } from './dotnet.js';
import { ACPClient, type ACPSession, type ACPResponse } from './acp-client.js';
import { resetToStaging } from './git-helpers/index.js';

const IS_WINDOWS = CONFIG.AGENT_PLATFORM === 'windows';
const IS_WINE = CONFIG.AGENT_RUNTIME === 'wine';

/**
 * Kilo ACP mode IDs. The "code" and "plan" names come from the kilocode
 * fork's agent list (kilocode/agent/index.ts:284-449): the upstream
 * "build" agent is renamed to "code" (lines 313-326) and the "plan"
 * agent is patched with a read-only permission guard (lines 329-341).
 */
const MODE_CODE = 'code';
const MODE_PLAN = 'plan';

/**
 * Hard wall-clock cap (ms) for the agent-run build and test commands.
 * Matches the 5-minute ceiling advertised to the LLM in prompts/test.txt and
 * prompts/implementer.txt. `runCommand` SIGKILLs the process when this
 * elapses, and runs with stdin closed, so an interactive prompt or a
 * watch/server process can never hang the testing stage.
 */
const TEST_CMD_TIMEOUT_MS = 300000;

/**
 * Compute the canonical plan file path for the current job. Stable
 * across retries so the LLM overwrites the same file each time.
 * Lives under `.kilo/plans/` in the repo — the only directory the
 * plan-mode LLM has write access to (per kilo's plan-mode
 * permission guard at kilocode/agent/index.ts:329-341).
 *
 * The `.kilo/plans/` directory is pre-created here. On the first
 * call it also needs the `.kilo/` parent directory; `recursive:
 * true` handles that.
 */
function planFilePath(): string {
    const slug = (CONFIG.JOB_ID || 'current-job')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .substring(0, 64);
    const dir = path.join(CONFIG.REPO_PATH, '.kilo', 'plans');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${slug}.md`);
}

/**
 * Wipe all .md plan files from the plan-mode write directories
 * in the repo. Called at the start of every `runPlan()` invocation
 * (initial and retries) so the planner LLM starts from a clean
 * slate — the plan it produces is the only plan file in any of
 * `.kilo/plans/`, `.plans/`, or `.opencode/plans/` afterwards.
 *
 * This is a deterministic TS pre-condition; we don't ask the LLM
 * to clean up because that's flaky and depends on the LLM
 * following instructions precisely. Doing it in TS guarantees
 * `readPlan()`'s "most recently modified" pick always returns the
 * current job's plan, not a leftover from a previous run.
 *
 * Also clears the legacy `/tmp/IMPLEMENTATION_PLAN.md` location so
 * `readPlan()` doesn't fall back to a stale plan there.
 */
function clearPlanDirs(): void {
    const planDirs = [
        path.join(CONFIG.REPO_PATH, '.kilo', 'plans'),
        path.join(CONFIG.REPO_PATH, '.plans'),
        path.join(CONFIG.REPO_PATH, '.opencode', 'plans'),
    ];
    for (const dir of planDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            for (const entry of fs.readdirSync(dir)) {
                if (entry.endsWith('.md')) {
                    fs.unlinkSync(path.join(dir, entry));
                }
            }
        } catch { /* ignore unreadable dirs */ }
    }
    // Legacy fallback read by readPlan() — clear it too so a
    // stale plan from a previous run doesn't win the "most recent"
    // race against the new plan the LLM is about to write.
    const legacyPath = '/tmp/IMPLEMENTATION_PLAN.md';
    if (fs.existsSync(legacyPath)) {
        try { fs.unlinkSync(legacyPath); } catch { /* ignore */ }
    }
}

/**
 * Stages of the work-execution state machine. The string literals
 * MUST match the canonical list in
 * `components/web-ui/src/components/dashboard/JobDetailModal.tsx`
 * (PIPELINE_STAGES) — that's what the web-ui renders in the
 * job-detail timeline, and the orchestrator
 * (`components/orchestrator/src/wss.ts:197-209`) forwards the stage
 * string verbatim to the web-ui. Any mismatch here causes the
 * timeline to skip the unknown stage silently.
 *
 * The loop in `execute()` transitions: blueprinting → implementing →
 * testing → reviewing. Any failure sends the loop back to
 * 'blueprinting' with the failure context as the new
 * `whatToImplement` payload. The loop exits when 'reviewing' returns
 * success. The post-loop, run-once stages are 'documenting' and
 * 'pushing'.
 *
 * The full `Stage` union (including 'setup', 'documenting', 'pushing')
 * is defined in `./agent-status.ts`.
 */

interface PlanResult {
    success: boolean;
    sessionId: string;
}

interface ImplementResult {
    success: boolean;
}

interface BuildTestResult {
    success: boolean;
    errorLog: string;
}

interface ReviewResult {
    success: boolean;
    repairHint: string;
}

export class WorkflowEngine {
    private readonly checkpointBranch = `feature-${CONFIG.JOB_ID}`;
    private workBranchName: string;

    private diffPath: string = path.join(CONFIG.HOME_DIR, 'DIFF.patch');
    private reviewPath: string = path.join(CONFIG.HOME_DIR, 'REVIEW.json');
    private testReportPath: string = path.join(CONFIG.HOME_DIR, 'TEST_REPORT.json');

    private getSkillsDir(): string {
        const containerPath = CONFIG.AGENT_PLATFORM === 'windows' ? 'C:\\SKILLS' : '/SKILLS';
        if (fs.existsSync(containerPath)) {
            return containerPath;
        }
        const relativeToAgent = path.resolve(process.cwd(), '..', '..', 'data', 'SKILLS');
        if (fs.existsSync(relativeToAgent)) {
            return relativeToAgent;
        }
        const relativeToRoot = path.resolve(process.cwd(), 'data', 'SKILLS');
        if (fs.existsSync(relativeToRoot)) {
            return relativeToRoot;
        }
        return path.resolve(process.cwd(), 'prompts', 'SKILLS');
    }

    private skillsDir: string = this.getSkillsDir();
    private promptTemplateCache: Map<string, string> = new Map();

    private client: ACPClient | null = null;
    private currentSession: ACPSession | null = null;

    constructor() {
        this.workBranchName = `${this.checkpointBranch}-${Date.now()}`;
    }

    // -------------------------------------------------------------------------
    // Top-level orchestrator
    // -------------------------------------------------------------------------

    public async execute() {
        let success = false;
        try {
            await this.setupConfig();
            await this.diagnostics();
            AgentStatus.set('setup', 1, CONFIG.MAX_RETRIES);

            console.log('###############################################');
            console.log('###############################################');
            console.log('##############     SETUP    ###################');
            console.log('###############################################');
            console.log('###############################################');
            console.log('Starting phase: SETUP');

            await this.prepareRepository();

            console.log(`[engine] tool runtime: ${CONFIG.AGENT_RUNTIME}` +
                (IS_WINE ? ' (kilo acp runs under Wine using the Windows Node/npm toolchain)' : ' (native)'));
            this.client = await ACPClient.init({
                cwd: CONFIG.REPO_PATH,
                acpCwd: toAgentPath(CONFIG.REPO_PATH),
                useWineBridge: IS_WINE,
                turnInactivityTimeoutMs: CONFIG.AGENT_MAX_TIMEOUT > 0
                    ? CONFIG.AGENT_MAX_TIMEOUT * 1000
                    : 0,
            });

            messenger.onCheckpoint(async () => {
                await this.checkpointCommit();
            });

            await this.runSetup();

            // ---- Stage state machine ----
            // Drives blueprinting → implementing → testing →
            // reviewing, looping back to blueprinting on any failure
            // with the failure context as the new whatToImplement
            // payload.
            //
            // The plan+implement session is kept alive across all
            // retries — never closed. On any failure, runPlan
            // mode-switches the same session back to plan, sends the
            // failure context, and re-plans. This preserves the
            // LLM's conversation history so previously-applied fixes
            // aren't lost or undone.
            let stage: Stage = 'blueprinting';
            const originalStory = CONFIG.STORY_CONTENT;
            let whatToImplement = CONFIG.STORY_CONTENT;
            let planSessionId: string | null = null;
            let retryCount = 0;
            const MAX_RETRIES = CONFIG.MAX_RETRIES;

            while (true) {
                if (stage === 'blueprinting') {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        throw new Error('Max retries reached: blueprinting stage failed.');
                    }
                    AgentStatus.set('blueprinting', retryCount, MAX_RETRIES);
                    console.log('###############################################');
                    console.log('###############################################');
                    console.log('##############   BLUEPRINT  ###################');
                    console.log('###############################################');
                    console.log('###############################################');
                    // Reuse the existing plan+implement session on
                    // retries; pass null on the first call to create
                    // a new one. runPlan mode-switches back to plan
                    // internally.
                    const result = await this.runPlan(whatToImplement, planSessionId);
                    if (result.success) {
                        planSessionId = result.sessionId;
                        stage = 'implementing';
                        continue;
                    }                    
                    continue;
                }

                if (stage === 'implementing') {
                    AgentStatus.set('implementing', retryCount, MAX_RETRIES);
                    console.log('###############################################');
                    console.log('###############################################');
                    console.log('##############   IMPLEMENT  ###################');
                    console.log('###############################################');
                    console.log('###############################################');
                    if (!planSessionId) {
                        throw new Error('implement stage reached without a plan session id');
                    }
                    // Pass the ORIGINAL story so the implementer
                    // keeps the implementation coherent with the
                    // broader requirements (even on retries where
                    // whatToImplement is a failure context).
                    const result = await this.runImplement(planSessionId, originalStory);
                    if (result.success) {
                        stage = 'testing';
                        continue;
                    }
                    // Keep the same session — mode-switch back to
                    // plan in the next blueprinting iteration.
                    stage = 'blueprinting';
                    continue;
                }

                if (stage === 'testing') {
                    AgentStatus.set('testing', retryCount, MAX_RETRIES);
                    console.log('###############################################');
                    console.log('###############################################');
                    console.log('##############     TEST     ###################');
                    console.log('###############################################');
                    console.log('###############################################');
                    const result = await this.runBuildAndTest();
                    if (result.success) {
                        stage = 'reviewing';
                        continue;
                    }
                    // Keep the same session — runPlan will mode-switch
                    // it back to plan on the next blueprinting iteration
                    // and re-plan with the test error log.
                    whatToImplement =
                        `Build/test failed with:\n\n${result.errorLog}\n\n` +
                        `Fix all remaining errors. Do not revert any previously applied fix.`;
                    stage = 'blueprinting';
                    continue;
                }

                if (stage === 'reviewing') {
                    AgentStatus.set('reviewing', retryCount, MAX_RETRIES);
                    const result = await this.runReview();
                    if (result.success) {
                        break;
                    }
                    // Keep the same session — runPlan will mode-switch
                    // it back to plan on the next blueprinting iteration
                    // and re-plan with the review repair hint.
                    whatToImplement = result.repairHint;
                    stage = 'blueprinting';
                    continue;
                }
            }

            // ---- Post-loop, run once ----
            AgentStatus.set('documenting');
            await this.runDocument();

            AgentStatus.set('pushing');
            await this.finish();

            console.log('Workflow completed successfully.');
            success = true;
            messenger.sendFinish('success', { branch: this.workBranchName });
        } catch (err: any) {
            console.error(`Fatal Error: ${err.message}`);
            const maxRetriesReached = err.message.includes('Max retries reached') || err.message.includes('Failed after max retries');
            messenger.sendFinish('error', { error: err.message, maxRetriesReached });
        } finally {
            setTimeout(() => process.exit(success ? 0 : 1), 1000);
        }
    }

    // -------------------------------------------------------------------------
    // Stage: setup
    // -------------------------------------------------------------------------

    /**
     * Run the setup stage in a fresh code-mode session. The session is
     * allowed to run shell, edit files, etc. — the verdict is read from
     * the assistant's final text.
     */
    private async runSetup(): Promise<void> {
        if (!this.client) throw new Error('ACPClient not initialized');

        console.log('Updating package lists...');
        await runCommand('apt-get', ['update', '-y']);

        const setupShPath = path.join(CONFIG.REPO_PATH, 'setup.sh');

        let buildRetries = 0;
        let buildSuccess = false;
        let isEmptyProject = false;

        while (buildRetries < CONFIG.MAX_RETRIES && !buildSuccess) {
            if (fs.existsSync(setupShPath)) {
                console.log(`Running setup script: ${setupShPath}`);
                await runCommand('bash', [setupShPath], CONFIG.REPO_PATH);
            } else {
                // No openVeloDir creation needed anymore
            }

            let buildOutput = '';
            let buildCode = 0;
            if (CONFIG.BUILD_CMD) {
                console.log(`Running build command: ${CONFIG.BUILD_CMD}`);
                const res = await runCommand('bash', ['-c', CONFIG.BUILD_CMD], CONFIG.REPO_PATH);
                buildCode = res.code ?? 1;
                buildOutput = res.output;
            }

            let testOutput = '';
            let testCode = 0;
            const files = fs.readdirSync(CONFIG.REPO_PATH).filter(f => !['.git', '.gitkeep'].includes(f));
            const isEmpty = files.length === 0;

            if (buildCode === 0 && CONFIG.TEST_CMD && !isEmpty && !isEmptyProject) {
                console.log(`Running test command: ${CONFIG.TEST_CMD}`);
                const res = await runCommand('bash', ['-c', CONFIG.TEST_CMD], CONFIG.REPO_PATH, TEST_CMD_TIMEOUT_MS);
                testCode = res.code ?? 1;
                testOutput = res.output;
            }

            if (buildCode !== 0 || testCode !== 0) {
                const setupPrompt = this.renderPromptTemplate('setup.txt', {
                    REPO_IS_EMPTY: isEmpty ? 'true' : 'false',
                    BUILD_CMD: CONFIG.BUILD_CMD || '(none)',
                    BUILD_OUTPUT: buildOutput.substring(0, 4000),
                    TEST_CMD: CONFIG.TEST_CMD || '(none)',
                    TEST_OUTPUT: testOutput.substring(0, 4000),
                    SETUP_SH_PATH: toAgentPath(setupShPath),
                    VERDICT_PATH: toAgentPath('/tmp/VERDICT'),
                    STORY_TITLE: CONFIG.JOB_TITLE || '(none)',
                    STORY_CONTENT: CONFIG.STORY_CONTENT || '(none)',
                });

                const session = await this.client.createSession({
                    model: CONFIG.BACKEND_MODEL,
                    mode: MODE_CODE,
                });
                this.currentSession = session;
                // Delete any stale verdict file from a previous run
                // (or a previous iteration of this loop) so the LLM
                // can't accidentally see / inherit a leftover verdict.
                const verdictPath = '/tmp/VERDICT';
                if (fs.existsSync(verdictPath)) fs.unlinkSync(verdictPath);
                await session.sendMessage(setupPrompt);
                this.currentSession = null;

                // The setup prompt instructs the LLM to write the file
                // /tmp/VERDICT containing one of four single-line
                // strings: SETUP_OK, SETUP_ADJUSTED, BUILD_ERROR,
                // EMPTY_PROJECT. We don't parse the LLM's response text
                // — reasoning models put their final answer in
                // agent_thought_chunk, which is invisible to us. The
                // file is the only signal.
                const verdict = this.readSetupVerdict();
                console.log(`[setup] verdict file: ${verdict ?? '(missing)'}`);

                if (verdict === 'SETUP_OK') {
                    buildSuccess = true;
                } else if (verdict === 'EMPTY_PROJECT') {
                    isEmptyProject = true;
                    buildSuccess = true;
                } else if (verdict === 'SETUP_ADJUSTED') {
                    console.log('LLM adjusted setup.sh. Committing changes...');
                    await runCommand('git', ['add', 'setup.sh'], CONFIG.REPO_PATH);
                    await runCommand('git', ['commit', '-m', 'chore: adjust setup.sh for missing dependencies/tools'], CONFIG.REPO_PATH);
                    buildRetries++;
                } else if (verdict === 'BUILD_ERROR') {
                    throw new Error('Max retries reached: Actual build or test logic error detected by LLM.');
                } else {
                    throw new Error(
                        `Setup LLM did not write a valid verdict to ${verdictPath}.\n` +
                        `Expected one of: SETUP_OK, SETUP_ADJUSTED, BUILD_ERROR, EMPTY_PROJECT.\n` +
                        `Got: ${verdict === null ? '(file missing)' : JSON.stringify(verdict)}`,
                    );
                }
            } else {
                buildSuccess = true;
            }
        }

        if (!buildSuccess) {
            throw new Error('Max retries reached: Setup (build/test) failed after max retries.');
        }

        console.log('Setup phase complete.');
    }

    // -------------------------------------------------------------------------
    // Stage: plan → implement (the reusable implementer primitive)
    // -------------------------------------------------------------------------

    /**
     * The implementer primitive:
     *   1. Create a plan-mode session; first message = `planContext`.
     *   2. The plan agent writes /tmp/IMPLEMENTATION_PLAN.md.
     *   3. setMode('code') on the same session.
     *   4. Implement — the plan is in conversation history, so a short
     *      prompt suffices.
     *
     * `planContext` is the job description (initial call) or a fix
     * request (test failure or review findings).
     */
    /**
     * Stage 1: blueprinting. Creates a plan-mode session on the
     * first call, or reuses the existing one on retries (mode-switch
     * back to plan), and sends the context (initial job description,
     * build/test error log, or review repair hint — depending on
     * where in the loop we are). The plan agent writes
     * /tmp/IMPLEMENTATION_PLAN.md.
     *
     * Returns the session id so the next `implement` stage can
     * mode-switch the same session to code mode and continue.
     *
     * On the first call, the full planner preamble is prepended so
     * the LLM has the SKILLS / docs/index.md loading
     * instructions. On retries (sessionId provided + session exists),
     * the preamble is omitted because it's already in the
     * conversation history — only the failure context is sent.
     */
    private async runPlan(planContext: string, sessionId: string | null = null): Promise<PlanResult> {
        if (!this.client) throw new Error('ACPClient not initialized');

        // Clear any stale plan files from a previous run / previous
        // attempt BEFORE invoking the LLM. The LLM's job is to produce
        // a single canonical plan at planPath — if old plans are lying
        // around in .kilo/plans/ (or .plans/ or .opencode/plans/),
        // readPlan()'s "most recently modified" pick could land on the
        // wrong file, or the LLM could get confused by leftover context.
        // Done in TS (not by the LLM) because it's a deterministic
        // pre-condition for the plan stage.
        clearPlanDirs();

        const planPath = planFilePath();
        const planPromptValues = {
            REPO_PATH: toAgentPath(CONFIG.REPO_PATH),
            STORY_CONTENT: planContext,
            PLAN_PATH: toAgentPath(planPath),
            SKILLS_PATH: toAgentPath(this.skillsDir),
            DATA_PATH: toAgentPath('/data'),
        };

        let session: ACPSession;
        let message: string;
        if (sessionId) {
            const existing = this.client.getSession(sessionId);
            if (!existing) {
                // The session was closed externally (subprocess death,
                // user abort, etc.). Fall back to creating a new one
                // and send the full preamble.
                console.warn(`[plan] session ${sessionId} not found; creating a new one`);
                session = await this.client.createSession({
                    model: CONFIG.BACKEND_BLUEPRINT_MODEL,
                    mode: MODE_PLAN,
                });
                message = this.renderPromptTemplate('planner.txt', planPromptValues);
            } else {
                await existing.setMode(MODE_PLAN);
                console.log(`[plan] reusing session ${existing.id}, switched to plan mode`);
                session = existing;
                message = planContext;
            }
        } else {
            session = await this.client.createSession({
                model: CONFIG.BACKEND_BLUEPRINT_MODEL,
                mode: MODE_PLAN,
            });
            console.log(`[plan] starting new plan session ${session.id}`);
            message = this.renderPromptTemplate('planner.txt', planPromptValues);
        }

        this.currentSession = session;
        await session.sendMessage(message);

        const plan = this.readPlan();
        console.log(`[plan] plan written: ${plan.length} chars`);

        this.currentSession = null;

        // Success if the plan agent wrote a real plan. The skeleton
        // fallback is what `readPlan()` returns when the plan agent
        // didn't write a plan file to any of the plan-mode write
        // locations (.kilo/plans/, .plans/, .opencode/plans/).
        const success = plan.length > 0 && !plan.startsWith('# Implementation Plan (Skeleton)');
        return { success, sessionId: session.id };
    }

    /**
     * Stage 2: implement. Takes the plan session created by `runPlan`
     * and switches it to code mode + the implementation model, then
     * asks it to implement the plan it just wrote. The session
     * retains the plan, the SKILLS content, the architecture, and the
     * story in its conversation history (the planner loaded them in
     * the previous turn), so we just send a short reminder
     * (`prompts/implementer.txt`) with a pointer to the plan file —
     * no plan re-inlining, no duplicated system-prompt text.
     *
     * The planner runs on `BACKEND_BLUEPRINT_MODEL`; the implementer
     * must run on `BACKEND_MODEL` (each stage uses a dedicated model).
     * We switch via `session/set_config_option` (`configId: "model"`)
     * — same RPC `createSession` uses to set the initial model.
     *
     * `storyContent` is currently unused (the reminder is shared
     * across initial and retry calls) but kept in the signature for
     * symmetry with `runPlan` and to make it trivial to thread a
     * job-specific message through if needed later.
     */
    private async runImplement(sessionId: string, _storyContent: string = CONFIG.STORY_CONTENT): Promise<ImplementResult> {
        if (!this.client) throw new Error('ACPClient not initialized');
        const session = this.client.getSession(sessionId);
        if (!session) {
            // The plan session was closed between stages (e.g., the
            // agent exited or the subprocess died). Treat as failure
            // so the loop goes back to blueprinting.
            return { success: false };
        }
        this.currentSession = session;
        await session.setMode(MODE_CODE);
        await session.setModel(CONFIG.BACKEND_MODEL);
        console.log(`[implement] switched session ${session.id} to code mode (model=${CONFIG.BACKEND_MODEL})`);

        const planPath = planFilePath();
        // The implementer runs in the SAME session as the planner, so
        // SKILLS, architecture, and story loaded during the planning
        // turn — plus the plan the LLM itself wrote — are already in
        // conversation history. We just send the (short) implementer
        // reminder with a {{PLAN_PATH}} pointer so the LLM can
        // re-read the plan from disk if context compacts.
        const implementPrompt = this.renderPromptTemplate('implementer.txt', {
            PLAN_PATH: toAgentPath(planPath),
        });
        await session.sendMessage(implementPrompt);
        this.currentSession = null;
        return { success: true };
    }

    // -------------------------------------------------------------------------
    // Stage: build + test (single iteration — the loop is in execute())
    // -------------------------------------------------------------------------

    /**
     * Build + test runner.
     *
     * The authoritative build/test execution is driven by the AGENT (not
     * the LLM) via `runCommand`, which closes stdin
     * (`stdio: ['ignore', 'pipe', 'pipe']`) and enforces a hard SIGKILL
     * timeout (`TEST_CMD_TIMEOUT_MS`). This guarantees a test that waits on
     * user interaction, runs in watch mode, or spawns a long-running
     * server can never hang the testing stage — it gets EOF on stdin and
     * is killed at the timeout. Watch flags are stripped and `CI=true` is
     * injected before running.
     *
     * One LLM session runs first, but only to bring the repository to
     * "State X" (git clean, restore dependencies). The LLM no longer runs
     * the long-lived test command and no longer authors the verdict — the
     * agent computes pass/build_failed/tests_failed directly from exit
     * codes. The state machine in `execute()` calls this once per `testing`
     * stage entry and handles retries on failure.
     */
    private async runBuildAndTest(): Promise<BuildTestResult> {
        if (fs.existsSync(this.testReportPath)) fs.unlinkSync(this.testReportPath);

        if (!this.client) throw new Error('ACPClient not initialized');

        // Check for any unstaged changes left over from the implementing stage
        console.log('[test] Checking for unstaged modified/untracked files...');
        const statusRes = await runCommand('git', ['status', '--porcelain'], CONFIG.REPO_PATH);
        if (statusRes.code === 0 && statusRes.output.trim() !== '') {
            console.log(`[test] Found unstaged changes:\n${statusRes.output}`);
            console.log('[test] Staging all files...');
            await runCommand('git', ['add', '-A'], CONFIG.REPO_PATH);
        }

        // ---- Step 1: LLM brings the repo to State X (prep only) ----
        const session = await this.client.createSession({
            model: CONFIG.BACKEND_MODEL,
            mode: MODE_CODE,
        });
        this.currentSession = session;

        const testPrompt = this.renderPromptTemplate('test.txt', {
            REPO_PATH: toAgentPath(CONFIG.REPO_PATH),
            BUILD_CMD: CONFIG.BUILD_CMD || '(none)',
            TEST_CMD: CONFIG.TEST_CMD || '(none)',
        });
        await session.sendMessage(testPrompt);
        this.currentSession = null;

        // ---- Step 2: Agent runs the build command (bounded, stdin closed) ----
        if (CONFIG.BUILD_CMD) {
            const buildCmd = this.sanitizeRunCommand(CONFIG.BUILD_CMD, 'build');
            console.log(`Running build command: ${buildCmd}`);
            const buildRes = await runCommand(
                'bash',
                ['-c', `CI=true ${buildCmd}`],
                CONFIG.REPO_PATH,
                TEST_CMD_TIMEOUT_MS,
            );
            if (buildRes.code !== 0) {
                const errorLog = buildRes.output.slice(-8000);
                console.error(`Build failed (verdict: build_failed). Errors:\n${errorLog}`);
                this.writeTestReport('build_failed', errorLog);
                return { success: false, errorLog };
            }
        }

        // ---- Step 3: Agent runs the test command (bounded, stdin closed) ----
        if (!CONFIG.TEST_CMD) {
            console.log('No test command configured — treating build success as pass.');
            this.writeTestReport('pass', '');
            return { success: true, errorLog: '' };
        }

        const testCmd = this.sanitizeRunCommand(CONFIG.TEST_CMD, 'test');
        console.log(`Running test command: ${testCmd}`);
        const testRes = await runCommand(
            'bash',
            ['-c', `CI=true ${testCmd}`],
            CONFIG.REPO_PATH,
            TEST_CMD_TIMEOUT_MS,
        );

        if (testRes.code !== 0) {
            const errorLog = testRes.output.slice(-8000);
            console.error(`Tests failed (verdict: tests_failed). Errors:\n${errorLog}`);
            this.writeTestReport('tests_failed', errorLog);
            return { success: false, errorLog };
        }

        console.log('Build and Tests passed!');
        this.writeTestReport('pass', '');
        return { success: true, errorLog: '' };
    }

    /**
     * Strip watch-mode flags from a build/test command so it runs once and
     * exits. Logs when a watch flag was removed so the operator can see the
     * sanitized command that actually ran.
     */
    private sanitizeRunCommand(command: string, kind: 'build' | 'test'): string {
        if (isWatchMode(command)) {
            const stripped = stripWatchFlags(command);
            console.warn(
                `[${kind}] watch-mode flag detected in command; stripping it ` +
                `so the run terminates.\n  original: ${command}\n  sanitized: ${stripped}`,
            );
            return stripped;
        }
        return command;
    }

    /**
     * Write the agent-computed verdict to TEST_REPORT.json. Kept for
     * compatibility with anything that inspects the report file; the
     * authoritative pass/fail signal is the return value of
     * `runBuildAndTest`.
     */
    private writeTestReport(
        verdict: 'pass' | 'build_failed' | 'tests_failed',
        errorLog: string,
    ): void {
        try {
            fs.writeFileSync(
                this.testReportPath,
                JSON.stringify({ verdict, error_log: errorLog }, null, 2),
                'utf-8',
            );
        } catch (err: any) {
            console.error(`Failed to write TEST_REPORT.json: ${err.message}`);
        }
    }

    // -------------------------------------------------------------------------
    // Stage: review
    // -------------------------------------------------------------------------

    /**
     * Stage 4: review. Own code-mode session, produces
     * /tmp/REVIEW.json with verdict + findings + repair_hint.
     * Returns `{ success: true, repairHint: '' }` on a pass
     * verdict (or a missing/unparseable REVIEW.json, treated as
     * pass). Returns `{ success: false, repairHint: ... }` on any
     * non-pass verdict; the repairHint is fed back as
     * `whatToImplement` for the next blueprinting iteration.
     */
    private async runReview(): Promise<ReviewResult> {
        if (!this.client) throw new Error('ACPClient not initialized');
        this.ensureGitIgnore();

        console.log('###############################################');
        console.log('###############################################');
        console.log('##############    REVIEW    ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: REVIEW');

        if (fs.existsSync(this.reviewPath)) fs.unlinkSync(this.reviewPath);

        const session = await this.client.createSession({
            model: CONFIG.BACKEND_REVIEW_MODEL,
            mode: MODE_CODE,
        });
        this.currentSession = session;

        const reviewPrompt = this.renderPromptTemplate('review.txt', {
            STORY_CONTENT: CONFIG.STORY_CONTENT,
            REPO_PATH: toAgentPath(CONFIG.REPO_PATH),
            SKILLS_PATH: toAgentPath(this.skillsDir),
            REVIEW_PATH: toAgentPath(this.reviewPath),
            STAGING_BRANCH: CONFIG.STAGING_BRANCH,
        });
        await session.sendMessage(reviewPrompt);
        this.currentSession = null;

        if (!fs.existsSync(this.reviewPath)) {
            console.log('REVIEW.json not written by reviewer — treating as pass.');
            return { success: true, repairHint: '' };
        }

        let reviewData: any;
        try {
            reviewData = JSON.parse(fs.readFileSync(this.reviewPath, 'utf-8'));
        } catch {
            console.log('REVIEW.json is not valid JSON — treating as pass.');
            return { success: true, repairHint: '' };
        }

        const verdict: string = reviewData.verdict ?? 'pass';
        const repairHint: string = reviewData.repair_hint ?? '';
        const findings: string = reviewData.findings ?? '';

        if (verdict === 'pass') {
            console.log(`Review verdict: ${verdict}. ${findings}`);
            return { success: true, repairHint: '' };
        }
        console.error(`Review verdict: ${verdict}. ${findings}`);
        return { success: false, repairHint: repairHint || findings };
    }

    // -------------------------------------------------------------------------
    // Stage: document
    // -------------------------------------------------------------------------

    private async runDocument(): Promise<void> {
        if (!this.client) throw new Error('ACPClient not initialized');

        console.log('###############################################');
        console.log('###############################################');
        console.log('##########     DOCUMENTING    #################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: DOCUMENT');

        const session = await this.client.createSession({
            model: CONFIG.BACKEND_DOCUMENTATION_MODEL,
            mode: MODE_CODE,
        });
        this.currentSession = session;

        const docPrompt = this.renderPromptTemplate('document.txt', {
            STORY_CONTENT: CONFIG.STORY_CONTENT,
            REPO_PATH: toAgentPath(CONFIG.REPO_PATH),
            SKILLS_PATH: toAgentPath(this.skillsDir),
            CHECKPOINT_BRANCH: this.checkpointBranch,
            STAGING_BRANCH: CONFIG.STAGING_BRANCH,
        });
        await session.sendMessage(docPrompt);
        this.currentSession = null;

        console.log('Documentation phase complete. Staging documentation changes...');
        await runCommand('git', ['add', 'docs'], CONFIG.REPO_PATH);
        const statusRes = await runCommand('git', ['status', '--porcelain', 'docs'], CONFIG.REPO_PATH);

        if (statusRes.output.trim() !== '') {
            await runCommand('git', ['commit', '-m', 'docs: update documentation to OKF v0.1 format', '--', 'docs'], CONFIG.REPO_PATH);
        }
    }

    // -------------------------------------------------------------------------
    // Stage: push
    // -------------------------------------------------------------------------

    private async finish() {
        console.log('###############################################');
        console.log('###############################################');
        console.log('##############     PUSH     ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: FINISH');

        const filesToRemove = [
            'opencode.json',
            'kilo.json',
            'implementer-notes.md'
        ];
        for (const file of filesToRemove) {
            const filePath = path.join(CONFIG.REPO_PATH, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Removed ${file} before commit.`);
            }
        }

        // Unstage/untrack implementer-notes.md explicitly in case it got staged
        await runCommand('git', ['rm', '--cached', 'implementer-notes.md']).catch(() => {});

        this.ensureGitIgnore();
        await runCommand('git', ['add', '.']);

        // Resolve the base ref for diff/merge-base/rebase. When the
        // staging branch has been pushed (origin/<staging> exists), use
        // it so we rebase onto the latest remote changes. When the
        // staging branch only exists locally (new repo, single
        // developer, or pre-push state), fall back to the local ref —
        // otherwise every `origin/<staging>` call fails with
        // `fatal: Not a valid object name origin/<staging>` and the
        // push aborts. See ensureFeatureBranch for the matching fix
        // on the create side.
        const { code: originStagingCheck } = await runCommand(
            'git',
            ['ls-remote', '--exit-code', '--heads', 'origin', CONFIG.STAGING_BRANCH],
        );
        const stagingOnRemote = originStagingCheck === 0;

        console.log('Fetching latest staging before push...');
        if (stagingOnRemote) {
            await runCommand('git', ['fetch', 'origin', CONFIG.STAGING_BRANCH]);
        } else {
            // Staging is local-only. The PR we are about to create
            // targets `CONFIG.STAGING_BRANCH` on origin, so the branch
            // must exist on the remote — push it now so the PR has a
            // valid base. Skip when there's nothing to push (no commits
            // ahead of the default branch) and let the API report the
            // missing base if needed.
            console.log(`origin/${CONFIG.STAGING_BRANCH} missing — pushing local ${CONFIG.STAGING_BRANCH} to origin as PR base`);
            const pushResult = await runCommand('git', ['push', '-u', 'origin', CONFIG.STAGING_BRANCH]);
            if (pushResult.code !== 0) {
                console.warn(`push -u origin ${CONFIG.STAGING_BRANCH} failed (continuing): ${pushResult.output.split('\n').pop() || 'unknown error'}`);
            }
        }

        const baseRef = stagingOnRemote ? `origin/${CONFIG.STAGING_BRANCH}` : CONFIG.STAGING_BRANCH;
        let baseCommit = baseRef;
        const { output: mbOutput, code: mbCode } = await runCommand('git', ['merge-base', baseRef, 'HEAD']);
        if (mbCode === 0 && mbOutput.trim()) {
            baseCommit = mbOutput.trim();
        }

        const { output: diffOutput } = await runCommand('git', ['diff', baseCommit, '--cached', '--name-only']);
        if (!diffOutput.trim()) {
            console.log('No changes detected compared to staging. Nothing to commit or push — task is already complete or had no effect. Marking job as successful.');
            await this.cleanupLocalAndCheckpointBranches();
            return;
        }

        const { output: stagedDiff } = await runCommand('git', ['diff', '--cached', '--name-only']);
        if (stagedDiff.trim()) {
            const titleSuffix = CONFIG.JOB_TITLE ? `: ${CONFIG.JOB_TITLE}` : '';
            await runCommand('git', ['commit', '-m', `feat${titleSuffix}`]);
        } else {
            console.log('All changes are already committed.');
        }

        console.log('Rebasing onto latest staging...');
        const { code: rebaseCode } = await runCommand('git', ['rebase', baseRef]);
        if (rebaseCode !== 0) {
            console.error('Rebase failed with conflicts. Aborting and exiting...');
            await runCommand('git', ['rebase', '--abort']);
            throw new Error('Rebase failed with conflicts. Cannot push broken branch.');
        }

        const { output: postRebaseDiff } = await runCommand('git', ['diff', `${baseRef}..HEAD`, '--name-only']);
        if (!postRebaseDiff.trim()) {
            console.log('All changes on this branch are already present in staging. Skipping push and PR creation.');
            await this.cleanupLocalAndCheckpointBranches();
            return;
        }

        // Always push the feature branch to origin (it will be created
        // there if missing) — origin/<staging> not existing does not
        // block the feature-branch push.
        await runCommand('git', ['push', 'origin', this.workBranchName, '--force-with-lease']);

        console.log('Creating Pull Request to staging...');
        try {
            let prId: number;
            if (CONFIG.REPO_HOST === 'azure-devops') {
                prId = await createAdoPR(this.workBranchName);
            } else if (CONFIG.REPO_HOST === 'gitea') {
                prId = await createGiteaPR(this.workBranchName);
            } else if (CONFIG.REPO_HOST === 'bitbucket') {
                prId = await createBitbucketPR(this.workBranchName);
            } else {
                prId = await createGithubPR(this.workBranchName);
            }
            console.log(`Pull Request #${prId} has been successfully merged and closed.`);
        } catch (prErr: any) {
            console.error(`PR failed: ${prErr.message}. Cleaning up before exit...`);
            await this.deleteFeatureBranch();
            throw prErr;
        }

        console.log('Cleaning up checkpoint branch if it exists...');
        const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (cpRemoteExists === 0) {
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
        }

        console.log('Deleting local work branch...');
        await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]);
        await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => { });
    }

    // -------------------------------------------------------------------------
    // Helpers (pure functions extracted from the old workflow)
    // -------------------------------------------------------------------------

    private loadPromptTemplate(fileName: string): string {
        const cached = this.promptTemplateCache.get(fileName);
        if (cached) return cached;

        const templatePath = path.resolve(process.cwd(), 'prompts', fileName);
        const content = fs.readFileSync(templatePath, 'utf-8');
        this.promptTemplateCache.set(fileName, content);
        return content;
    }

    private renderPromptTemplate(fileName: string, values: Record<string, string>): string {
        const template = this.loadPromptTemplate(fileName);
        return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? '');
    }

    /**
     * Read the plan the plan-mode agent wrote. Checks, in order:
     *   1. /tmp/IMPLEMENTATION_PLAN.md (legacy convention)
     *   2. The most-recently-modified .md file under .kilo/plans/,
     *      .plans/, .opencode/plans/ in the repo cwd (kilo's
     *      plan-mode write locations — see
     *      kilocode/agent/index.ts:170-178)
     *
     * Returns the skeleton if no plan file is found. The blueprinting
     * stage treats a non-skeleton return as success and advances to
     * 'implement'; the skeleton return causes the state machine to
     * loop, so falling back to a skeleton here would lock the
     * workflow in blueprinting.
     *
     * Static + parameterized for unit testability.
     */
    public static readPlan(
        repoPath: string = CONFIG.REPO_PATH,
        tmpPath: string = '/tmp/IMPLEMENTATION_PLAN.md',
    ): string {
        // 1. Legacy /tmp/ location.
        if (fs.existsSync(tmpPath)) {
            console.log(`Implementation plan read from ${tmpPath}`);
            return fs.readFileSync(tmpPath, 'utf-8');
        }

        // 2. Kilo's plan-mode write locations in cwd. Glob each
        //    directory and pick the most recently modified .md.
        const planDirs = ['.kilo/plans', '.plans', '.opencode/plans'];
        for (const dir of planDirs) {
            const fullDir = path.join(repoPath, dir);
            if (!fs.existsSync(fullDir)) continue;
            let bestPath: string | null = null;
            let bestMtime = 0;
            try {
                const entries = fs.readdirSync(fullDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
                    const full = path.join(fullDir, entry.name);
                    const mtime = fs.statSync(full).mtimeMs;
                    if (mtime > bestMtime) {
                        bestMtime = mtime;
                        bestPath = full;
                    }
                }
            } catch { /* ignore unreadable dirs */ }
            if (bestPath) {
                console.log(`Implementation plan read from ${bestPath}`);
                return fs.readFileSync(bestPath, 'utf-8');
            }
        }

        console.warn(
            'Warning: plan agent did not write a plan file to any of:\n' +
            '  /tmp/IMPLEMENTATION_PLAN.md\n' +
            '  .kilo/plans/*.md\n' +
            '  .plans/*.md\n' +
            '  .opencode/plans/*.md\n' +
            'Using skeleton plan.',
        );
        return '# Implementation Plan (Skeleton)\n\nFailed to automatically generate a detailed plan. Please proceed with standard exploration.';
    }

    /** Instance wrapper that delegates to the static method. */
    private readPlan(): string {
        return WorkflowEngine.readPlan();
    }

    /**
     * Read the verdict the LLM wrote to /tmp/VERDICT. The setup prompt
     * instructs the LLM to use its file-writing tool to create this
     * file with one of four strings on a single line. We don't parse
     * the LLM's response text — reasoning models put their final
     * answer in agent_thought_chunk, which is invisible to us. The
     * file is the only signal the workflow reads.
     *
     * Static so it can be unit-tested without instantiating the
     * WorkflowEngine (which would spawn a real `kilo acp` subprocess).
     *
     * Returns:
     *   - one of 'SETUP_OK' | 'SETUP_ADJUSTED' | 'BUILD_ERROR' | 'EMPTY_PROJECT'
     *   - 'UNKNOWN' if the file exists but contains something else
     *   - null if the file does not exist
     */
    public static readSetupVerdict(verdictPath: string = '/tmp/VERDICT'): 'SETUP_OK' | 'SETUP_ADJUSTED' | 'BUILD_ERROR' | 'EMPTY_PROJECT' | 'UNKNOWN' | null {
        if (!fs.existsSync(verdictPath)) {
            return null;
        }
        const content = fs.readFileSync(verdictPath, 'utf-8').trim();
        switch (content) {
            case 'SETUP_OK':
            case 'SETUP_ADJUSTED':
            case 'BUILD_ERROR':
            case 'EMPTY_PROJECT':
                return content;
            default:
                return 'UNKNOWN';
        }
    }

    private readSetupVerdict(): 'SETUP_OK' | 'SETUP_ADJUSTED' | 'BUILD_ERROR' | 'EMPTY_PROJECT' | 'UNKNOWN' | null {
        return WorkflowEngine.readSetupVerdict();
    }

    // -------------------------------------------------------------------------
    // Pre-existing shell-only helpers (unchanged from the old workflow)
    // -------------------------------------------------------------------------

    private async setupConfig() {
        console.log('Setting up configuration environment...');
    }

    private async diagnostics() {
        console.log('Starting phase: DIAGNOSTICS');
        const resolvedBackend = CONFIG.BACKEND === 'opencode' ? 'kilo' : CONFIG.BACKEND;
        const whichCmd = IS_WINDOWS ? 'where' : 'which';
        const rootDir = IS_WINDOWS ? 'C:\\' : '/';
        const { code } = await runCommand(whichCmd, [resolvedBackend], rootDir);
        if (code !== 0) throw new Error(`Tool ${resolvedBackend} not found in PATH.`);
        await runCommand(resolvedBackend, ['--version'], rootDir);

        const { code: dotnetCode } = await runCommand('dotnet', ['--version'], rootDir);
        if (dotnetCode !== 0) {
            console.log('dotnet CLI not available — .NET builds will not be supported.');
        }
    }

    private async ensureFeatureBranch() {
        const { code: remoteCheck } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (remoteCheck === 0) {
            console.log(`Resuming from checkpoint origin/${this.checkpointBranch}...`);
            await runCommand('git', ['fetch', 'origin', this.checkpointBranch]);

            const newTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.workBranchName = `${this.checkpointBranch}-${newTimestamp}`;

            await runCommand('git', ['checkout', '-b', this.workBranchName, `origin/${this.checkpointBranch}`]);
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
            console.log(`Checkpoint branch deleted. Working in ${this.workBranchName}.`);
            return;
        }

        // No checkpoint to resume from. Create the feature branch from
        // whichever staging ref is actually available — origin/<staging>
        // when the remote has it, otherwise the local <staging> that the
        // FUSE mount (or the fallback reset in prepareRepository) just
        // checked out. Previously this hardcoded origin/<staging>, which
        // failed with "not a commit" whenever the staging branch had
        // never been pushed (the agent then silently continued working
        // on the staging branch instead of a dedicated feature branch).
        const { code: originStagingCheck } = await runCommand(
            'git',
            ['ls-remote', '--exit-code', '--heads', 'origin', CONFIG.STAGING_BRANCH],
        );
        const baseRef = originStagingCheck === 0
            ? `origin/${CONFIG.STAGING_BRANCH}`
            : CONFIG.STAGING_BRANCH;
        console.log(`Starting fresh with new branch ${this.workBranchName} from ${baseRef}...`);
        const result = await runCommand('git', ['checkout', '-b', this.workBranchName, baseRef]);
        if (result.code !== 0) {
            throw new Error(
                `Failed to create feature branch ${this.workBranchName} from ${baseRef}: ${result.output}`,
            );
        }
    }

    private async checkpointCommit() {
        console.log('Checkpoint requested — committing current work...');
        try {
            await runCommand('git', ['add', '.']);
            const timestamp = new Date().toISOString();
            await runCommand('git', ['commit', '--allow-empty', '-m', `wip: checkpoint ${timestamp}`]);
            await runCommand('git', ['push', 'origin', this.checkpointBranch]);
            console.log('Checkpoint committed to remote branch.');
        } catch (err: any) {
            console.error(`Checkpoint commit failed: ${err.message}`);
        }
        messenger.sendCheckpointDone();
    }

    private async prepareRepository() {
        if (!CONFIG.REPO_URL) throw new Error('REPO_URL not provided');
        if (!CONFIG.STAGING_BRANCH) throw new Error('STAGING_BRANCH not provided');

        const sharedRepoPath = process.env.SHARED_REPO_PATH || '/shared_repo';
        const repoPath = CONFIG.REPO_PATH;

        // Shared package: validates /shared_repo/.git exists, refreshes
        // tracking refs, spawns gbfs mount, and remote-wins resets /repo.
        await resetToStaging({
            sharedRepoPath,
            repoPath,
            stagingBranch: CONFIG.STAGING_BRANCH,
            runCommand,
        });

        await this.ensureFeatureBranch();

        const isWindows = CONFIG.AGENT_PLATFORM === 'windows';
        // Paths in kilo.json are read by the kilo engine, so they must be in
        // the engine's path form: Windows (C:\...) for a native Windows agent
        // or for the Wine runtime, Linux otherwise.
        const skillsExternalPath = (isWindows || IS_WINE) ? 'C:\\SKILLS' : '/SKILLS';
        const tmpExternalPath = IS_WINE ? 'C:\\tmp' : '/tmp';

        const kiloConfigPath = path.join(CONFIG.REPO_PATH, 'kilo.json');
        fs.writeFileSync(kiloConfigPath, JSON.stringify({
            $schema: 'https://kilo.ai/config.json',
            permission: {
                '*': 'allow',
                'ask_user': 'deny',
                'question': 'deny',
                // Deny subagent spawning. The `task` tool launches a nested
                // subagent session whose work is opaque to the workflow and
                // produces no agent-visible output for long stretches —
                // observed to hang the documenting phase (logged as a
                // pending `other`-kind tool call that never completes). Kilo
                // surfaces the deny to the LLM as a normal tool rejection, so
                // it falls back to direct tools (read/grep/glob/edit) and the
                // phase stays a single, observable session.
                'task': 'deny',
                'external_directory': {
                    [tmpExternalPath]: 'allow',
                    [`${tmpExternalPath}/**`]: 'allow',
                    [`${tmpExternalPath}\\**`]: 'allow',
                    [skillsExternalPath]: 'allow',
                    [`${skillsExternalPath}/**`]: 'allow',
                    [`${skillsExternalPath}\\**`]: 'allow'
                }
            }
        }, null, 2), 'utf-8');

        await dotnetSetup();
    }

    private ensureGitIgnore(): void {
        const gitIgnorePath = path.join(CONFIG.REPO_PATH, '.gitignore');
        let existingLines: string[] = [];
        if (fs.existsSync(gitIgnorePath)) {
            existingLines = fs.readFileSync(gitIgnorePath, 'utf-8').split('\n');
        }

        const patternsByMarker: Record<string, string[]> = {
            'package.json': ['node_modules/', 'dist/', '.npm/'],
            'Cargo.toml': ['target/'],
            'go.mod': ['*.exe', '*.exe~', '*.dll', '*.so', '*.dylib'],
            'Gemfile': ['vendor/bundle/'],
            'pyproject.toml': ['__pycache__/', '*.pyc', '.venv/', '*.egg-info/'],
            'requirements.txt': ['__pycache__/', '*.pyc', '.venv/'],
        };

        const markerExtensions: Record<string, string[]> = {
            '.csproj': ['bin/', 'obj/'],
            '.sln': ['bin/', 'obj/'],
        };

        const patternsToAdd = new Set<string>();

        for (const [marker, patterns] of Object.entries(patternsByMarker)) {
            if (fs.existsSync(path.join(CONFIG.REPO_PATH, marker))) {
                for (const p of patterns) patternsToAdd.add(p);
            }
        }

        const repoFiles = fs.existsSync(CONFIG.REPO_PATH) ? fs.readdirSync(CONFIG.REPO_PATH) : [];
        for (const file of repoFiles) {
            const ext = path.extname(file);
            if (markerExtensions[ext]) {
                for (const p of markerExtensions[ext]) patternsToAdd.add(p);
            }
        }

        if (fs.existsSync(path.join(CONFIG.REPO_PATH, 'implementer-notes.md'))) {
            patternsToAdd.add('implementer-notes.md');
        }

        const missing: string[] = [];
        for (const pattern of patternsToAdd) {
            const exists = existingLines.some(line => line.trim() === pattern);
            if (!exists) missing.push(pattern);
        }

        if (missing.length === 0) return;

        const header = existingLines.length === 0
            ? '# Automatically added by OpenVelo agent\n'
            : '';
        const content = header + missing.join('\n') + '\n';
        fs.appendFileSync(gitIgnorePath, content, 'utf-8');
        console.log(`Appended to .gitignore: ${missing.join(', ')}`);
    }

    private async cleanupLocalAndCheckpointBranches() {
        await runCommand('git', ['reset', '--hard']).catch(() => {});
        await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]);
        await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => {});
        const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (cpRemoteExists === 0) {
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
        }
    }

    private async deleteFeatureBranch(): Promise<void> {
        await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]).catch(async () => {
            await runCommand('git', ['checkout', '--detach']);
        });

        const { code: workLocalExists } = await runCommand('git', ['rev-parse', '--verify', this.workBranchName]);
        if (workLocalExists === 0) {
            await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => { });
        }

        console.log(`Cleaning up checkpoint branch ${this.checkpointBranch}...`);
        const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (cpRemoteExists === 0) {
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
        }
    }
}
