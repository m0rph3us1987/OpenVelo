# Tester Architecture

The `tester` is a containerised, agent-driven QA runner for **test-type** jobs (see `jobs.type = 'test'` in the web-ui). It was rewritten from Go to TypeScript so the executable behaviour (WebSocket protocol, prompts, MongoDB-style verdict storage, ACP-style `kilo acp` plumbing) matches the agent's idioms one-for-one.

It drives a real X11 desktop inside the container (Xvfb + x11vnc + openbox) and exposes a Python **controller** over MCP (FastMCP / FastAPI) that wraps the AT-SPI accessibility tree. The LLM uses that controller as its only window into the GUI — i.e. the tester reads buttons, types text, clicks, and takes screenshots *through* accessible actions, not by feeding raw pixel data.

## 1. Directory Structure & Key Files
- `src/`: TypeScript source (compiled to `dist/` by `tsc`, run via `node dist/index.js`).
  - `index.ts` — Entry point. Overrides `process.stdout.write` / `stderr.write` to route output through `messenger.log()` (WebSocket). Branches on `TESTER_DEBUG=true` (debug mode: run `setup`, park the container with a keepalive HTTP server) vs. SERVER mode (start the WS server and wait for the orchestrator's handshake).
  - `workflow.ts` — `WorkflowEngine` class running the **3-stage** pipeline: `runSetup()` → `runTest()` → `runVerdict()`.
  - `messenger.ts` — `WebSocketServer` on `CONFIG.TESTER_PORT` (default `3001`). Handles inbound `handshake` (apply config, start workflow) and `checkpoint` (flush + send `checkpoint_done`). Outbound: `log()`, `sendAgentStatus()`, `sendCheckpointDone()`, `sendFinish()`. `sendFinish()` is a promise that resolves only after the frame is flushed to the socket — the workflow awaits it before `process.exit` so the orchestrator doesn't see a drop-without-`finish` and trigger a spurious retry.
  - `agent-status.ts` — Singleton reactive stage state (`stage`, `attempt`, `maxRetries`, `plan`, `usage`, `context`). `messenger.ts` calls `AgentStatus.attach(ws)` on each connection; mutations auto-emit `sendAgentStatus()`.
  - `acp-client.ts` — JSON-RPC 2.0 client over stdio to the `kilo acp` subprocess (one per session). Spawns the child, parses tool logs / reasoning deltas, and exposes `createSession(mode)` and `session.sendMessage()`.
  - `acp-schema.ts` — Types for the ACP wire protocol (sessions, plans, plan entries, prompts).
  - `config.ts` — Static `CONFIG` populated from env or from the orchestrator's `handshake.config` payload via `applyHandshake()`. Defines `TESTER_HAND` and `TESTER_PORT`, `REPO_*`, `BACKEND_*`, `TEST_PLAN`, `JOB_ID`, `JOB_TITLE`, VNC/MCP ports, and verdict paths (`VERDICTS_DIR`, `VERDICT_PATH`).
  - `shell.ts` — `runCommand` (timeout, watch-mode detection). `repo.ts` — `mountAndCheckout` (authenticated GBFS mount + branch). `kilojson.ts` — `writeKiloJson` (permission scaffolding) and `verifier.ts` — `readVerdict`.
  - `logger.ts` — Per-job in-process logger (separate from `messenger.ts`).
- `prompts/`:
  - `test_plan.md` — Planning-mode prompt that subdivides the test plan into ordered entries (used in 1a).
  - `test_system.md` — Per-entry code-mode prompt (used in 1b, once per plan entry).
  - `verdict_system.md` — Code-mode prompt that consumes the merged verdict files and emits the terminal `TEST_VERDICT.json`.
- `mcp/`: Python **controller** — a FastMCP server (also exposed as plain HTTP under `/mcp` or SSE under `/sse`) that wraps the AT-SPI accessibility tree (`atspi_tools.py`) and X11 helpers (`xwin_tools.py`). Started by `entrypoint.sh` before the TS layer.
- `Dockerfile`, `docker-compose.yml`, `entrypoint.sh` — Container image and start sequence (Xvfb → x11vnc → python MCP controller → compiled JS).

## 2. Wire Protocol
The tester speaks the **same** WS wire format as the agent (`messenger.ts` + `agent-status.ts` mirror the agent modules). Inbound message types:

| Type | Effect |
|------|--------|
| `handshake` | `applyHandshake(config)` populates `CONFIG`; `index.ts` then calls `engine.execute()`. |
| `checkpoint` | Run the registered checkpoint callback; emit `checkpoint_done`. |

Outbound message types are identical to the agent (`log`, `stage`, `plan`, `usage`, `context`, `checkpoint_done`, `finish`). The orchestrator's `agentws.ConnectToTester` (`components/orchestrator/internal/agentws/conn.go:50-81`) builds a `TesterHandshakeConfig` with `repo_branch` + `test_plan` and `agentws.runJobWebSocket` is the shared dial→handshake→read-loop plumbing (`conn.go:87-365`).

## 3. Lifecycle Phases (`WorkflowEngine.execute()`)

```
+----------+   +---------------------+   +---------------------------+
|  setup   |-->|       test          |-->|         verdict           |
| (GBFS    |   | (1a plan + 1b exec) |   | (merge verdicts, emit     |
| mount +  |   |                     |   |  TEST_VERDICT.json)       |
| kilo.json|   |                     |   |                           |
| + .open- |   |                     |   |                           |
| velo/    |   |                     |   |                           |
| setup.sh)|   |                     |   |                           |
+----------+   +---------------------+   +---------------------------+
```

### 3.1 `runSetup()`
- `mountAndCheckout()` the repository using the authenticated URL & PAT from the handshake via GBFS.
- `writeKiloJson()` for agent-style permission scaffolding.
- Run `.openvelo/setup.sh` if present.
- On any failure, return `{ ok: false, step, error }` (the orchestrator receives a non-success `finish`).

### 3.2 `runTest()` — two sub-stages
- **1a. Planning session** (`mode: 'plan'`)
  - Renders `prompts/test_plan.md` with `{{TEST_PLAN}}` and `{{REPO_PATH}}`.
  - The LLM emits an ordered list of plan entries via ACP's `todowrite`. These are captured in `planSession.planEntries`.
  - If no entries are emitted, the engine degrades to a single entry covering the entire test plan (logs a warning) — never fails the whole job on an empty todo list.
- **1b. Per-entry execution sessions** (`mode: 'code'`)
  - For each entry: create a **fresh** code-mode ACP session (no shared history) and render `prompts/test_system.md` with the entry content + `{{ENTRY_INDEX}}` / `{{ENTRY_TOTAL}}`.
  - After each run, write `VERDICTS_DIR/<ENTRY_INDEX>.json` (a JSON verdict file). These are the cross-entry artefact channel — subsequent entries don't see prior entry history, only the verdict files on disk.
  - Uses the **live GUI on the X11 display** (`{{DISPLAY}}`, `{{SCREEN_W}}x{{SCREEN_H}}x24`) as its sole shared runtime state.

### 3.3 `runVerdict()`
- Reads every `VERDICTS_DIR/<index>.json` file in order, concatenates them, and runs a final code-mode session with `prompts/verdict_system.md`.
- The LLM emits the terminal `TEST_VERDICT.json` (`/tmp/verdict.json`). `verifier.readVerdict()` consumes it and `messenger.sendFinish('success' | 'error', data)` flushes the frame to the orchestrator.

## 4. Stage / Log Events Sent via WebSocket
Identical to the agent (see [components/agent.md](agent.md) §6). `tester` phases emitted are `setup` / `testing` / `verifying`.

## 5. Integration Points
- **Orchestrator** — `agentws.ConnectToTester` (`components/orchestrator/internal/agentws/conn.go:50-81`) builds the `TesterHandshakeConfig` (with `repo_branch`+`test_plan`) and calls `runJobWebSocket` (shared with the agent). Dispatch is driven by `jobs.type === 'test'` and image selection is `cfg.DockerImageTester || job.DockerImage || openvelo-tester:linux` (`components/orchestrator/internal/workflow/job_runner.go:63-75`).
- **Web-UI** —
  - The VNC proxy at `components/web-ui/server.ts:586-...` (path `/api/vnc/:jobId`) proxies noVNC traffic to the tester's published x11vnc port (stored as `jobs.vnc_host_port`).
  - `VncViewerPage` (`components/web-ui/src/pages/VncViewerPage.tsx`) renders the noVNC client and the live log/agent-status panel for a given job.
  - The plan stage can write `test_plan_markdown` onto a `jobs` row so the tester has a real plan to act on (see [components/web-ui.md](web-ui.md) §2).
  - `JobTypeBadge` (`components/web-ui/src/components/dashboard/JobTypeBadge.tsx`) renders `Test` (amber) vs. `Implement` (blue) based on `jobs.type`.
- **Test job schema (`jobs`)** — `type` (default `'implementation'`; `'test'` triggers tester dispatch), `test_plan_markdown` (TEXT, populated on test jobs), `implements_job_id` (self-FK → implementation job), `vnc_host_port` (INTEGER; latched on first RUNNING transition). See [components/web-ui.md](web-ui.md) §2.
