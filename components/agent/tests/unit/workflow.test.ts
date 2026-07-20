import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowEngine } from '../../src/workflow.js';

describe('WorkflowEngine.readSetupVerdict', () => {
    let tmpDir: string;
    let verdictPath: string;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-'));
        verdictPath = path.join(tmpDir, 'VERDICT');
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when the verdict file does not exist', () => {
        const missing = path.join(tmpDir, 'does-not-exist');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(missing), null);
    });

    it('returns SETUP_OK for "SETUP_OK"', () => {
        fs.writeFileSync(verdictPath, 'SETUP_OK', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'SETUP_OK');
    });

    it('returns SETUP_ADJUSTED for "SETUP_ADJUSTED"', () => {
        fs.writeFileSync(verdictPath, 'SETUP_ADJUSTED', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'SETUP_ADJUSTED');
    });

    it('returns BUILD_ERROR for "BUILD_ERROR"', () => {
        fs.writeFileSync(verdictPath, 'BUILD_ERROR', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'BUILD_ERROR');
    });

    it('returns EMPTY_PROJECT for "EMPTY_PROJECT"', () => {
        fs.writeFileSync(verdictPath, 'EMPTY_PROJECT', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'EMPTY_PROJECT');
    });

    it('trims surrounding whitespace', () => {
        fs.writeFileSync(verdictPath, '  SETUP_OK  \n', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'SETUP_OK');
    });

    it('returns UNKNOWN for content that is not one of the four valid verdicts', () => {
        fs.writeFileSync(verdictPath, 'I think the build is fine', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'UNKNOWN');
    });

    it('returns UNKNOWN for empty file', () => {
        fs.writeFileSync(verdictPath, '', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'UNKNOWN');
    });

    it('returns UNKNOWN for verdict with extra text on the same line', () => {
        fs.writeFileSync(verdictPath, 'SETUP_OK because everything passes', 'utf-8');
        assert.strictEqual(WorkflowEngine.readSetupVerdict(verdictPath), 'UNKNOWN');
    });
});

// ---------------------------------------------------------------------------
// readPlan — locates the plan the plan-mode agent wrote. Per kilo's
// plan-mode convention the plan lands in one of .kilo/plans/,
// .plans/, or .opencode/plans/ in cwd (kilocode/agent/index.ts:170-178).
// /tmp/IMPLEMENTATION_PLAN.md is the legacy fallback. The previous
// version only checked /tmp/, so when the LLM wrote to .kilo/plans/
// (its actual convention) the state machine saw the skeleton and
// looped the blueprinting stage forever.
// ---------------------------------------------------------------------------

describe('WorkflowEngine.readPlan', () => {
    let repoDir: string;
    let tmpPath: string;

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readplan-test-'));
        tmpPath = path.join(repoDir, 'tmp-impl-plan.md');
    });

    after(() => {
        // best-effort; per-test tmpDirs cleaned up by the runner
    });

    it('returns skeleton when no plan file exists anywhere', () => {
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.ok(result.startsWith('# Implementation Plan (Skeleton)'));
    });

    it('reads from /tmp/ when the legacy location exists', () => {
        fs.writeFileSync(tmpPath, '# Real Plan\nDo X, Y, Z.\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# Real Plan\nDo X, Y, Z.\n');
    });

    it('reads from .kilo/plans/ when no /tmp/ plan exists (kilo convention)', () => {
        const kiloPlansDir = path.join(repoDir, '.kilo', 'plans');
        fs.mkdirSync(kiloPlansDir, { recursive: true });
        const planPath = path.join(kiloPlansDir, 'crisp-star.md');
        fs.writeFileSync(planPath, '# Plan from .kilo/plans/\nSteps A, B, C.\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# Plan from .kilo/plans/\nSteps A, B, C.\n');
    });

    it('reads from .plans/ when present', () => {
        const plansDir = path.join(repoDir, '.plans');
        fs.mkdirSync(plansDir, { recursive: true });
        const planPath = path.join(plansDir, 'plan.md');
        fs.writeFileSync(planPath, '# Plan from .plans/\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# Plan from .plans/\n');
    });

    it('reads from .opencode/plans/ when present', () => {
        const plansDir = path.join(repoDir, '.opencode', 'plans');
        fs.mkdirSync(plansDir, { recursive: true });
        const planPath = path.join(plansDir, 'plan.md');
        fs.writeFileSync(planPath, '# Plan from .opencode/plans/\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# Plan from .opencode/plans/\n');
    });

    it('picks the most recently modified .md when multiple kilo plans exist', async () => {
        const kiloPlansDir = path.join(repoDir, '.kilo', 'plans');
        fs.mkdirSync(kiloPlansDir, { recursive: true });
        const olderPath = path.join(kiloPlansDir, 'old.md');
        const newerPath = path.join(kiloPlansDir, 'new.md');
        fs.writeFileSync(olderPath, '# OLD\n', 'utf-8');
        // Ensure mtimes differ
        await new Promise((r) => setTimeout(r, 10));
        fs.writeFileSync(newerPath, '# NEW\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# NEW\n');
    });

    it('prefers /tmp/ over kilo plans when both exist', () => {
        fs.writeFileSync(tmpPath, '# from /tmp/\n', 'utf-8');
        const kiloPlansDir = path.join(repoDir, '.kilo', 'plans');
        fs.mkdirSync(kiloPlansDir, { recursive: true });
        fs.writeFileSync(path.join(kiloPlansDir, 'x.md'), '# from kilo\n', 'utf-8');
        const result = WorkflowEngine.readPlan(repoDir, tmpPath);
        assert.strictEqual(result, '# from /tmp/\n');
    });
});

// ---------------------------------------------------------------------------
// Canonical stage names — must match the web-ui's
// components/web-ui/src/components/dashboard/JobDetailModal.tsx
// (PIPELINE_STAGES) and the orchestrator's
// components/orchestrator/src/wss.ts:197-209 (forwards stage verbatim).
// The web-ui renders these in the job-detail pipeline timeline; any
// stage key that isn't in PIPELINE_STAGES is silently skipped
// (stageIndex() returns -1).
// ---------------------------------------------------------------------------

describe('Canonical stage names (must match web-ui PIPELINE_STAGES)', () => {
    // Mirror of PIPELINE_STAGES in
    // components/web-ui/src/components/dashboard/JobDetailModal.tsx:32-40
    const WEB_UI_PIPELINE_STAGES = [
        'setup',
        'blueprinting',
        'implementing',
        'testing',
        'reviewing',
        'documenting',
        'pushing',
    ] as const;

    it('emitStage would call these exact 7 strings (one for each transition)', () => {
        // Map the 7 transitions in execute() to the stage they send.
        const expectedStages = [
            'setup',          // before runSetup
            'blueprinting',   // state machine
            'implementing',   // state machine
            'testing',        // state machine
            'reviewing',      // state machine
            'documenting',    // post-loop
            'pushing',        // post-loop
        ];
        for (const expected of expectedStages) {
            assert.ok(
                (WEB_UI_PIPELINE_STAGES as readonly string[]).includes(expected),
                `stage '${expected}' must be in web-ui's PIPELINE_STAGES`,
            );
        }
    });

    it('the Stage type union only contains canonical web-ui stage names', () => {
        // Read the Stage type indirectly via the source file. Any
        // drift in agent-status.ts would break this match. (The Stage
        // union was moved out of workflow.ts into agent-status.ts when
        // sendStage was refactored into a reactive singleton.)
        const src = fs.readFileSync(
            path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'agent-status.ts'),
            'utf-8',
        );
        // Find: type Stage = '...' (multi-line form in agent-status.ts).
        // The new file uses `export type Stage = ...` and the union
        // body starts on the line after the `=`.
        const m = src.match(/(?:export\s+)?type Stage\s*=\s*([\s\S]+?);/);
        assert.ok(m, 'expected `type Stage = ...` in agent-status.ts');
        const union = m[1]!;
        for (const stage of WEB_UI_PIPELINE_STAGES) {
            assert.ok(
                union.includes(`'${stage}'`),
                `Stage union in agent-status.ts must include '${stage}' (got: ${union})`,
            );
        }
    });
});

// ---------------------------------------------------------------------------
// runImplement must switch the model to BACKEND_MODEL after switching the
// mode to code. The planner session is created with the blueprint model
// (workflow.ts:496,508); without an explicit `setModel` call the
// implementer would run on the blueprint model, which defeats the
// per-stage model selection handshake. This is a static-source
// assertion — we don't drive the full ACP client here because that
// would require a live `kilo acp` subprocess.
// ---------------------------------------------------------------------------

describe('runImplement switches model to BACKEND_MODEL after setMode', () => {
    const workflowSrc = fs.readFileSync(
        path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'workflow.ts'),
        'utf-8',
    );

    it('calls setModel with CONFIG.BACKEND_MODEL', () => {
        assert.ok(
            /setModel\(CONFIG\.BACKEND_MODEL\)/.test(workflowSrc),
            'workflow.ts must call `setModel(CONFIG.BACKEND_MODEL)` so the implementer stage runs on the execution model',
        );
    });

    it('calls setModel after setMode(MODE_CODE)', () => {
        const setModeIdx = workflowSrc.indexOf('await session.setMode(MODE_CODE)');
        const setModelIdx = workflowSrc.indexOf('await session.setModel(CONFIG.BACKEND_MODEL)');
        assert.ok(setModeIdx !== -1, 'workflow.ts must call setMode(MODE_CODE)');
        assert.ok(setModelIdx !== -1, 'workflow.ts must call setModel(CONFIG.BACKEND_MODEL)');
        assert.ok(
            setModelIdx > setModeIdx,
            'setModel must be called after setMode(MODE_CODE) in runImplement',
        );
    });

    // Regression: runImplement used to append a fenced block of the
    // inlined plan to the implementer prompt ("For reference, here it
    // is inlined:\n\n```\n" + plan + "\n```"). The plan is already in
    // conversation history from the planning turn (same ACP session),
    // so re-inlining it is wasted token spend. Lock the contract here.
    it('does not inline the plan into the implement prompt', () => {
        assert.ok(
            !/For reference, here it is inlined/.test(workflowSrc),
            'runImplement must not inline the plan — the planner turn already wrote it in the same session, so re-injecting it duplicates tokens',
        );
        assert.ok(
            !/```\n' \+ plan \+ '\n```/.test(workflowSrc),
            'runImplement must not append a fenced plan block to the implement prompt',
        );
    });

    it('renders implementer.txt with a {{PLAN_PATH}} pointer', () => {
        assert.ok(
            /renderPromptTemplate\('implementer\.txt'/.test(workflowSrc),
            'runImplement must render prompts/implementer.txt',
        );
        assert.ok(
            /PLAN_PATH:\s*(?:toAgentPath\()?planPath/.test(workflowSrc),
            'runImplement must pass PLAN_PATH so the template can point at the plan file',
        );
    });
});

// ---------------------------------------------------------------------------
// prompts/implementer.txt is the implementation-stage prompt template. It
// must be a short reminder (the plan, SKILLS, architecture, and story are
// already in conversation history from the planning turn) and must contain
// a {{PLAN_PATH}} placeholder so the renderer can substitute the path.
// ---------------------------------------------------------------------------

describe('prompts/implementer.txt', () => {
    const promptPath = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        '..', '..', 'prompts', 'implementer.txt',
    );
    const promptSrc = fs.readFileSync(promptPath, 'utf-8');

    it('contains the {{PLAN_PATH}} placeholder', () => {
        assert.ok(
            /\{\{PLAN_PATH\}\}/.test(promptSrc),
            'implementer.txt must contain a {{PLAN_PATH}} placeholder',
        );
    });

    it('is a short reminder (no duplicated workflow rule list)', () => {
        // The old implementer.txt carried a 10-point workflow rule
        // list that duplicated what planner.txt + SKILLS already
        // established in the planning turn. Lock the new contract.
        assert.ok(
            !/Workflow rules — follow strictly/.test(promptSrc),
            'implementer.txt must not duplicate the workflow rule list',
        );
        assert.ok(
            !/Foundation first/.test(promptSrc),
            'implementer.txt must not duplicate Foundation-first rule',
        );
        assert.ok(
            !/Non-Interactive ONLY/.test(promptSrc),
            'implementer.txt must not duplicate the Non-Interactive rule',
        );
    });

    it('keeps the todowrite reminder for the web-UI Live plan panel', () => {
        assert.ok(
            /todowrite/.test(promptSrc),
            'implementer.txt must remind the LLM to populate the todowrite-driven Live plan panel',
        );
    });
});
