# Agent Architecture

The `agent` component runs exclusively inside an isolated Linux Docker container and executes the core AI coding lifecycle (Setup → Plan → Implement → Test → Review → Document → Push) for a single User Story.

---

## 1. Directory Structure & Key Files
- `opencode.json`: **OpenCode Agent Permissions**. Located at repository root, this configuration file controls opencode agent permissions when running inside the container (e.g., external directory access to `/tmp` and `/SKILLS`).
- `src/`: TypeScript source code.
  - `index.ts`: **Entry Point**. Overrides `process.stdout.write` and `process.stderr.write` to route all container output through `messenger.log()` (WebSockets) before printing. It starts the WebSocket server (`messenger.startServer()`) and waits for the Orchestrator's handshake.
  - `workflow.ts`: **The Core Orchestrator**. Implements the `WorkflowEngine` class, containing the step-by-step state machine for executing and recovering coding jobs.
  - `messenger.ts`: **Agent-to-Orchestrator WebSocket Connection**. Starts a `WebSocketServer` listening on `CONFIG.AGENT_PORT` (normally 3001) that awaits connection from the Orchestrator.
  - `opencode-server.ts`: **LLM Daemon Manager**. Starts, monitors, and stops the local `opencode serve` process within the container to proxy model requests.
  - `session.ts`: **LLM History Registry**. Holds specific instances of `AgentSession` (`setup`, `plan`, `implement`, `document`) to maintain conversational history across retries.
  - `shell.ts`: Helper for spawning secure host shell commands and checking watch mode constraints.
  - `dotnet.ts`, `github.ts`, `gitea.ts`, `ado.ts`: Repository-specific tooling integrations.
- `prompts/`: Contains `.txt` templates defining the system instructions for each model task (`setup.txt`, `plan.txt`, `implement.txt`, `review.txt`, `document.txt`).

---

## 2. Communication and Lifecycle Flow

### Step 1: Initialization and Handshake
1. The container boots, executing `index.ts`.
2. The agent starts its WebSocket server on `3001`.
3. The Orchestrator (WebSocket Client) dials in and sends the `configure` payload containing project configuration including **per-phase model identifiers** (`blueprint_model`, `review_model`, `documentation_model`).
4. The agent parses the config (Git URL, token, build/test commands, per-phase LLM models, user story description) using `applyHandshake()`, and triggers `WorkflowEngine.execute()`.

### Step 2: Phase 1: Setup (`setup()`)
- Renders `prompts/setup.txt`.
- Clones the target git repository and checks out the project staging branch.
- Performs shell diagnostics to check language/platform configurations (e.g. dotnet vs npm).
- Starts `opencode serve` in the background to handle AI requests.

### Step 3: Phase 1.5: Planning & Blueprint (`plan()`)
- Renders `prompts/plan.txt`.
- Passes the user story backlog, acceptance criteria, and full directory tree to the LLM configured via `blueprint_model`.
- The LLM creates `.openvelo/blueprints/IMPLEMENTATION_PLAN.md` mapping out the modifications needed.

### Step 4: Inner Loop: Implement → Test → Review
The Agent executes the core coding task inside a retry loop capped by `CONFIG.MAX_RETRIES` using `execution_model` for implementation and `review_model` for review phases:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                         implement()                          │
│          (Sends plan, prompts, and gets edits)               │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                            test()                            │
│           (Runs project build_cmd and test_cmd)              │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
         [Tests Fail]                     [Tests Pass]
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│       fixImplementation()    │ │          review()           │
│  (Appends errors, retries)   │ │  (Git stages code, self-   │
│                              │ │   critiques diffs via LLM)  │
└──────────────┬───────────────┘ └──────────────┬───────┬──────┘
               │                                │       │
      [Retries Exceeded]                 [Fail Verdict] │
               │                                │       │
               ▼                                ▼       │
┌──────────────────────────────┐ ┌──────────────────────┐       │
│        Re-Evaluate           │ │ fixImplementation()  │       │
│ (Wipes implementation memory │ │ (Appends findings,   │       │
│   and calls plan() again)    │ │  loops back to test) │       │
└──────────────────────────────┘ └──────────────────────┘       │
                                                                │
                                                          [Pass Verdict]
                                                                │
                                                                ▼
                                                         To Document Phase
```

**Note**: The `review()` phase uses the `review_model` configured per-project, falling back to `default_model` if not set.

### Step 5: Phase 4: Document (`document()`)
- Triggered after review passes.
- Spawns the documentation step utilizing `prompts/document.txt` via `documentation_model`.
- Compares git diffs (`git diff origin/{{CHECKPOINT_BRANCH}}...HEAD`) to discover structural code modifications.
- Creates or updates specific markdown guides in `.openvelo/architecture/` (e.g., `components/` or `core/` subfolders) and maps them in `_INDEX.md`.

### Step 6: Phase 5: Finish (`finish()`)
- Git commits all remaining files.
- Rebases onto target staging branch to avoid merge conflicts.
- Forces pushes (`--force-with-lease`) to a remote branch named after `feature-{{JOB_ID}}`.
- Interacts with GitHub (`github.ts`), Gitea (`gitea.ts`), or Azure DevOps (`ado.ts`) API endpoints to construct a pull request and trigger auto-merging if configured.
- Issues a WebSocket `finish` event to the Orchestrator and exits.
