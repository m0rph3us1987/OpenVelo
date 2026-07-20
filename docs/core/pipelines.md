# Pipelines & Execution Models

## Planning Pipeline (Web UI)
The web-ui drives user intent through AI-assisted planning stages. Each stage in `components/web-ui/src/lib/workflow/stage-*.ts` loads a corresponding prompt from `components/web-ui/prompts/`. The full mapping is in [web-ui-state-machine.md](web-ui-state-machine.md).

## Execution Pipeline (Agent)
The agent executes code in a strict loop governed by `WorkflowEngine` in `components/agent/src/workflow.ts`. Phases (in order):

1. `setupConfig()` — no-op log
2. `diagnostics()` — verifies `which <BACKEND>` and `dotnet --version`
3. `setup()` — GBFS mount repo, branch bootstrap, write `kilo.json` permissions, `apt-get update`, optional `setup.sh`, run `BUILD_CMD` and `TEST_CMD`. If they fail, runs an LLM-assisted setup adjustment loop using `setup.txt` (writes `/tmp/VERDICT`).
4. `plan()` — `AgentStatus.set('blueprinting', retryCount, MAX_RETRIES)` → renders `planner.txt` via `BACKEND_BLUEPRINT_MODEL` (the `blueprint_model` from the handshake, falling back to `BACKEND_MODEL`) → writes `/tmp/IMPLEMENTATION_PLAN.md`
5. **Inner loop** (capped by `MAX_RETRIES`):
   - `implement()` — mode-switches the same plan+implement session to `code` mode. Sends `implementer.txt` (a short reminder with a `{{PLAN_PATH}}` pointer). The blueprint plan, SKILLS, architecture, and story are already in conversation history from the planning turn; the implementer can re-read the plan from disk if context compacts.
   - `test()` — runs `BUILD_CMD` (dotnet-aware) then `TEST_CMD` (uses `test.txt`). LLM writes `TEST_REPORT.json` (under `CONFIG.HOME_DIR`) with verdict/error log. Failure loops back to blueprinting (re-planning).
   - `review()` — only after `test()` passes. Renders `review.txt` via `BACKEND_REVIEW_MODEL`. LLM writes `REVIEW.json` (under `CONFIG.HOME_DIR`) with `verdict`/`findings`/`repair_hint`. Failure loops back to blueprinting (re-planning) with findings/repair hint.
6. `document()` — `document.txt` via `BACKEND_DOCUMENTATION_MODEL` → `git add .openvelo/architecture && git commit`
7. `finish()` — empty-diff short-circuit or full flow: commit, rebase, force-push, PR creator, cleanup, `sendFinish()`

## Plan Pipeline Prompt Architecture (Web UI)
The planning output is now **job-shaped**, not Epic/Feature/Story-shaped. The `plan` stage runs three prompts in sequence, each writing per-job files into `chatDir/plan/` and updating the `plan_jobs` DB table:

1. **`plan-jobs-discovery.md`** — emits the flat list of jobs (title, description, requirement-line mapping, build/test commands).
2. **`plan-jobs-orchestrator.md`** — writes per-job orchestration metadata (build/test overrides, dispatch hints).
3. **`plan-jobs-runner.md`** — produces the per-job runner prompt consumed later by the agent.
4. **`plan-dependencies.md`** (sub-stage `dependencies`) — computes `dependencies.json`, which the web-ui parses to populate `jobs.depends_on`.

The legacy `plan-epic.md` / `plan-feature.md` / `plan-story.md` flow was removed in the kilo migration. The `quick_story` (feature/quick chat) mode and its `plan-quickstory.md` prompt were subsequently removed completely.

## Dependency Model
Job execution order is driven by the SQLite `jobs.depends_on` column, not by an on-disk file. There are two producers of `depends_on`, and they must not be confused:

1. **Implementation ↔ test chain (deterministic, route-emitted)** — produced by `POST /api/projects/:id/create-jobs-from-stories` in `components/web-ui/src/api/routes/projects.ts:632-705`. The `plan-jobs-discovery` prompt emits a flat ordered `jobs` array where each implementation job is immediately followed by its paired test job (titles prefixed `Test: `). The route inserts all rows in order, assigning `jobs.type` (`'implementation'` or `'test'`), then walks the materialized list twice to set `depends_on` purely from position and type:
   - First implementation → `depends_on = []`.
   - Each subsequent implementation → `depends_on = [previous test]` (starts the chain if the prior test is missing).
   - Each test → `depends_on = [its implementation pair]` and `implements_job_id` = that implementation's id.
   - 400 if the first row already starts with `Test: ` (orchestrators cannot run a test with no upstream implementation).
   - Orphan tests (no preceding implementation in this plan) are skipped with a warning rather than created.
2. **Cross-job / cross-feature structural edges (`plan-dependencies.md`)** — the `plan/dependencies` sub-stage still runs `plan-dependencies.md`, which writes `chatDir/plan/dependencies.json` as a transient LLM output for edges **outside** the impl/test chain (e.g., inter-feature ordering). The web-ui parses it via `updatePlanStoryDependsOn()` to populate `plan_jobs.depends_on` and `jobs.depends_on` (JSON array of job IDs). The prompt itself instructs the LLM not to emit edges for the within-plan `I → T → I → T → …` chain — that chain is the route's job (see note in `components/web-ui/prompts/plan-dependencies.md`).

`POST /api/projects/:id/create-jobs-from-stories` also enforces cross-feature sequential dependencies at the legacy story-tree layer: a story in feature N+1 with no intra-feature deps depends on the last story of feature N.

At dispatch time, the orchestrator's 1 s poll sends `get_next_jobs` to the web-ui, which calls `getNextRunnableJobs(projectId, count)`. That function selects `PENDING` jobs whose predecessors are all `COMPLETED`. The orchestrator never reads `dependencies.json` directly.

## Retry Architecture
Three-level retry/recovery:

1. **Job-level** (web-ui, on `job_retry` from orchestrator) — `incrementJobRetry()`; > `max_retries` → FAILED, else reset to PENDING and re-dispatch. Applies to both `'implementation'` and `'test'` jobs.
2. **Container-level** (orchestrator) — inactivity watchdog or non-success `finish` → `dockerManager.stopAgent()`/`removeAgent()` (per `REMOVE_DELETED_CONTAINERS`) and `send({ type: 'job_retry' })`. Shared with the **tester** container (same `agentws.runJobWebSocket` plumbing).
3. **Agent-internal** (agent workflow) — unified blueprinting → implementing → testing → reviewing loop inside one run, capped by `MAX_RETRIES`. Any test or review failure loops back to blueprinting (re-planning), keeping the plan+implement session alive to retain conversation history.

## Tester Pipeline (`jobs.type = 'test'`)
The **tester** container runs a different 3-stage loop (see [../components/tester.md](../components/tester.md) §3): `setup` (GBFS mount + `kilo.json` + `.openvelo/setup.sh`) → `test` (1a PLAN session subdivides the test plan into ordered entries via `todowrite`; 1b executes each entry in a **fresh** code-mode ACP session, writing `<VERDICTS_DIR>/<index>.json` per entry) → `verdict` (merges per-entry verdicts with `verdict_system.md` and emits `/tmp/TEST_VERDICT.json`). Per-entry ACP sessions are deliberately isolated so prior entry history never leaks across the test plan; the verdict files on disk are the only cross-entry artefact. The execution model reads the live X11 display (`{{DISPLAY}}`, `{{SCREEN_W}}x{{SCREEN_H}}x24`) through the Python MCP accessibility controller.

## Lifecycle State Transitions

```
       PENDING ──(getNextRunnableJobs + setJobsRunning)──► RUNNING
       RUNNING ──(finish success)──► COMPLETED            (branch set, runtime set)
       RUNNING ──(watchdog / fail / max retries)──► PENDING or FAILED
       RUNNING ──(user stop_job)──► STOPPED
       * ──(handleOrchestratorDeath)──► reset all RUNNING to PENDING
```

The web-ui is the single source of truth for job status. `setJobsRunning()` runs **before** the job is sent to the orchestrator (server.ts:346-354), so the DB reflects an in-flight job immediately. Stale `RUNNING` jobs from a previous run are reset on orchestrator `hello` (server.ts:332-339). `jobs.runtime` is computed at completion from `started_at` and the current wall clock. `jobs.agent_attempt`/`agent_max_retries` are updated on every `stage` message so the UI can show the per-phase retry counter.
