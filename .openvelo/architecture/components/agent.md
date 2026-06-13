# Agent Architecture

The `agent` component runs inside an isolated Linux or Windows Docker container and executes the AI coding lifecycle for a single User Story: `setupConfig → diagnostics → setup → blueprinting → implementing → testing → reviewing → documenting → pushing`.

---

## 1. Directory Structure & Key Files
- `src/`: TypeScript source.
  - `index.ts` — Entry point. Overrides `process.stdout.write`/`stderr.write` to route output through `messenger.log()` (WebSocket). Starts the WebSocket server and waits for the Orchestrator's `handshake`.
  - `workflow.ts` — `WorkflowEngine` class with the step-by-step state machine.
  - `messenger.ts` — `WebSocketServer` on `CONFIG.AGENT_PORT` (default 3001) accepting the Orchestrator's connection. Exposes `log()`, `sendAgentStatus()`, `sendCheckpointDone()`, `sendFinish()`.
  - `agent-status.ts` — Singleton holding the agent's reactive stage state (`stage`, `attempt`, `maxRetries`, `plan`, `usage`, `context`). Auto-emits updates via `sendAgentStatus()` whenever a field changes. `messenger.ts` calls `AgentStatus.attach(ws)` on connection.
  - `acp-client.ts` — Clean, dedicated client for the `kilo acp` subprocess. Owns the spawned child process and communicates using JSON-RPC 2.0 over stdio, parsing tool logs and reasoning deltas.
  - `acp-schema.ts` — Types and schemas for the ACP protocol.
  - `logger.ts` — Per-chat in-process logger (separate from `messenger.ts`).
  - `shell.ts` — Secure shell command spawning + watch-mode detection.
  - `config.ts` — Static `CONFIG` + `applyHandshake()` which populates it from the Orchestrator's `handshake` payload.
  - `dotnet.ts` — .NET-specific tooling.
  - `github.ts`, `gitea.ts`, `ado.ts`, `bitbucket.ts` — Per-host `createAndMergePR()` integrations.
- `prompts/`: Per-phase prompt templates — `setup.txt`, `planner.txt`, `implementer.txt`, `review.txt`, `document.txt`, `test.txt`.

## 2. Communication

The agent receives a **`handshake`** message (not `configure`) from the Orchestrator. The Web-UI sends `configure` to the Orchestrator (see [components/web-ui.md](web-ui.md)).

On handshake, the agent calls `applyHandshake()` which sets `REPO_URL`, `REPO_HOST`, `REPO_PAT`, `BACKEND`, and the four per-phase model fields (`execution_model` → `BACKEND_MODEL`, `blueprint_model` → `BACKEND_BLUEPRINT_MODEL`, `review_model` → `BACKEND_REVIEW_MODEL`, `documentation_model` → `BACKEND_DOCUMENTATION_MODEL`), plus `BUILD_CMD`, `TEST_CMD`, `STAGING_BRANCH`, `JOB_TITLE`. It also writes the story to `/tmp/story.md` (via `CONFIG.STORY_PATH`). The agent also registers a `messenger.onCheckpoint()` handler that flushes work on Orchestrator-issued `checkpoint` messages.

## 3. Lifecycle Phases (`WorkflowEngine.execute()`)

| # | Phase | Stage emitted | Key behavior |
|---|-------|---------------|--------------|
| 0 | `setupConfig()` | — | No-op log. |
| 0 | `diagnostics()` | — | Verifies `which <BACKEND>` + `dotnet --version`. |
| 1 | `setup()` | `setup` | `prepareRepository()` (clone + branch bootstrap + `kilo.json` write). `apt-get update`. Runs `.openvelo/setup.sh` if present. Runs `BUILD_CMD` and `TEST_CMD`. If they fail, runs an LLM-assisted setup adjustment loop using `setup.txt` prompt in a code-mode session (writes `/tmp/VERDICT` with `SETUP_OK`, `SETUP_ADJUSTED`, `BUILD_ERROR`, or `EMPTY_PROJECT`). |
| 2 | `plan()` | `blueprinting` | Renders `planner.txt` via `BACKEND_BLUEPRINT_MODEL` (falls back to `BACKEND_MODEL` when unset). Writes `/tmp/IMPLEMENTATION_PLAN.md` (skeleton fallback if LLM omits it). Accepts `failureContext` for re-planning. |
| 3 | Inner loop | `implementing` / `testing` / `reviewing` | See §4. `implement` uses `BACKEND_MODEL` and `implementer.txt`; `review` uses `BACKEND_REVIEW_MODEL` and `review.txt`. |
| 4 | `document()` | `documenting` | Renders `document.txt` via `BACKEND_DOCUMENTATION_MODEL`. Runs `git add .openvelo/architecture` and commits if anything changed. |
| 5 | `finish()` | `pushing` | See §5. |

## 4. Unified Blueprinting → Implementing → Testing → Reviewing Loop

- `blueprinting(whatToImplement)` — Renders `planner.txt` via `BACKEND_BLUEPRINT_MODEL` (falls back to `BACKEND_MODEL` when unset) to write `/tmp/IMPLEMENTATION_PLAN.md` guiding the changes. First turn gets original story; subsequent retry turns get failure/review context.
- `implement()` — Mode-switches the same plan+implement session to `code` mode. On attempt 0, sends `implementer.txt` prompt. On later attempts, sends only the injected error/findings context.
- `test()` — Runs `BUILD_CMD` and `TEST_CMD` under a code-mode session (uses `test.txt`). LLM writes `TEST_REPORT.json` under `CONFIG.HOME_DIR` containing `verdict` ('pass'|'build_failed'|'tests_failed') and `error_log`. If it fails, execution loops back to `blueprinting` to re-plan.
- `review()` — Runs only after `test()` passes. Creates a fresh code-mode session (uses `review.txt`) via `BACKEND_REVIEW_MODEL`. LLM writes `REVIEW.json` under `CONFIG.HOME_DIR` with `verdict` ('pass'|'fail'), `findings`, and `repair_hint`. If it fails, execution loops back to `blueprinting` to re-plan using the repair hint/findings.
- Capped by `CONFIG.MAX_RETRIES` (default 3) for the entire loop.

## 5. Finish (`finish()`)

- Removes the temporary `kilo.json` and `opencode.json` (so they never land in the user's repo) and refreshes `.gitignore`.
- **Empty-diff short-circuit**: if `git diff --cached --name-only` is empty, checks out `STAGING_BRANCH`, deletes the work + checkpoint branches, exits successfully without creating a PR.
- Otherwise: commit `feat: <JOB_TITLE>` → fetch `STAGING_BRANCH` → rebase onto `origin/STAGING_BRANCH` (aborts and throws on conflict) → force-push (`--force-with-lease`) the work branch `feature-<JOB_ID>-<timestamp>`.
- Calls the PR creator based on `REPO_HOST`:
  - `azure-devops` → `createAdoPR()`
  - `gitea` → `createGiteaPR()`
  - `bitbucket` → `createBitbucketPR()`
  - default (GitHub) → `createGithubPR()`
- Cleans up checkpoint + work branches, sends `messenger.sendFinish('success'|'error', { branch?, error?, maxRetriesReached? })`, then exits.

## 6. Stage / Log Events Sent via WebSocket

| Event | When | Notes |
|-------|------|-------|
| `log` (info/error/warn/stdout/stderr) | Every console write | `index.ts` intercepts `stdout`/`stderr` and routes through `messenger.log()`. |
| `stage` (setup/blueprinting/implementing/testing/reviewing/documenting/pushing) | Each phase entry | Includes `attempt` and `max_retries`. |
| `plan` | Plan progression updates | Emits the list of plan entries, their status, and priorities. |
| `usage` | LLM token usage delta | Emits cumulative tokens (input, output, cached, total). |
| `context` | Cost / context window limits | Emits size, used window, and cost. |
| `checkpoint_done` | In response to Orchestrator `checkpoint` | After `git commit` + `git push` of `feature-<JOB_ID>`. |
| `finish` | Workflow complete | Includes `status` (`success`/`error`), `branch`, `error`, `maxRetriesReached`. |
