# Web UI & Express API Architecture

The `web-ui` component serves as the central orchestration cockpit. It comprises a frontend React SPA (Vite, Tailwind, Radix UI) and an Express.js backend running on Node.js.

---

## 1. Directory Structure & Key Files
- `src/`: Frontend React SPA.
  - `pages/`: Page containers (e.g. `PlanPage.tsx` for requirements, `ExecutePage.tsx` for container monitoring).
  - `components/`: UI components (Tailwind CSS, Radix UI).
    - `plan/`: Chat sub-components (`ChatCollecting.tsx`, `ChatDomain.tsx`, etc.) mapped to active states.
  - `hooks/`: Custom state hooks (e.g. `useStageWebSocket.ts` to listen for stage shifts).
  - `context/`: Application state providers (e.g. `AuthContext`, `ToastContext`).
- `src/api/`: Backend Express.js Server.
  - `server.ts`: Starts the server (port 3000) and boots both REST routers and WebSocket Server endpoints.
  - `router.ts`: Coordinates API route mappings.
  - `routes/`: Express endpoint modules (`chats.ts`, `projects.ts`, `jobs.ts`, `auth.ts`).
  - `middleware/`: Authentication and workspace permission checks.
- `src/lib/`: Unified Core Utilities.
  - `db.ts`: SQLite schema and data accessor queries (using `better-sqlite3`).
  - `websocket-manager.ts`: Manages fanning out logs and status updates to browsers.
  - `stage-ws-manager.ts`: Manages WebSocket rooms scoped to active planning stages.
  - `opencode-serve-registry.ts`: Spawns and tracks active `opencode serve` proxy processes.

---

## 2. Core Database Schema & Relationships (`src/lib/db.ts`)

The database uses SQLite with WAL mode enabled. The primary tables are structured as follows:

```
                  ┌───────────────────────────────┐
                  │           projects            │
                  └───────────────┬───────────────┘
                                  │ 1
                                  │
                                  ├───────────────────────────────┐
                                  │ N                             │ N
                          ┌───────▼───────┐               ┌───────▼───────┐
                          │     jobs      │               │ chat_sessions │
                          └───────────────┘               └───────┬───────┘
                                                                  │ 1
                                                                  │
                                                          ┌───────▼───────┐
                                                          │ chat_messages │
                                                          └───────┬───────┘
                                                                  │ 1
                                                                  │
                                                          ┌───────▼───────┐
                                                          │message_options│
                                                          └───────────────┘
```

- **`projects`**: Stores project names, git URLs, PAT credentials, dynamic build/test command strings, maximum retries, timeouts, parallel limits, and **per-phase AI model configurations**. Each project can specify dedicated models for different agent phases via `blueprint_model`, `review_model`, `documentation_model`, with fallback to `default_model`.
- **`jobs`**: Tracks story execution, predecessor lists (`depends_on`), active docker container IDs, starting timestamps, runtime calculations, and retry counters.
- **`chat_sessions`**: Persists planning conversations. Stores active states (`stage` and `sub_stage`) along with the pre-error snapshot state (`sub_stage_pre_error`) to facilitate recovery.
- **`chat_messages`** & **`chat_message_options`**: Stores the full conversational transcript (role system vs user) and caches prompt alternatives/options suggested by the LLM.
- **`domains`**, **`domain_questions`** & **`domain_answers`**: Stores the domain outline and interactive Q&A state.

### Model Specialization (`getProjectModels()`)

The `projects` table stores nine model fields that control which AI model is used for each phase of the agent lifecycle:

| Field | Purpose | Fallback |
|-------|---------|----------|
| `default_model` | Primary model identifier | (required) |
| `execution_model` | Implementation & coding tasks | `default_model` |
| `blueprint_model` | Architecture & blueprint generation | `default_model` |
| `analyzer_model` | Code analysis & diagnostics | `default_model` |
| `chat_model` | Planning workflow conversational AI | `default_model` |
| `requirement_model` | Requirements elicitation | `default_model` |
| `planning_model` | Story breakdown & estimation | `default_model` |
| `review_model` | Code review & critique | `default_model` |
| `documentation_model` | Documentation generation | `default_model` |

The `getProjectModels(projectId)` function in `src/lib/db.ts` resolves all nine model identifiers for a given project, substituting `default_model` for any unset phase-specific model. This is called by the orchestrator to pass the correct model configuration to agent containers.

**Database Schema**: The `projects` table contains three new model columns added via migration:
- `blueprint_model TEXT NOT NULL DEFAULT ''`
- `review_model TEXT NOT NULL DEFAULT ''`
- `documentation_model TEXT NOT NULL DEFAULT ''`

### Model Validation on Project Start (`POST /:id/start`)

When a project execution is started via `POST /:id/start`, the API validates that any custom models (non-default) specified for `blueprint_model`, `execution_model`, `review_model`, or `documentation_model` exist in the `models` table. If a specified model is not found, the API returns a 400 error with a descriptive message instructing the user to refresh models or select a valid model in the Models tab of project settings.

The validation iterates through all four phase-specific models and checks them against the available models:

```typescript
const allResolvedModels = [
  { field: 'blueprint_model', value: models.blueprint_model },
  { field: 'execution_model', value: models.execution_model },
  { field: 'review_model', value: models.review_model },
  { field: 'documentation_model', value: models.documentation_model },
];
```

### Configure Message to Orchestrator (`server.ts`)

When an orchestrator connects via WebSocket (`/api/orchestrator/ws`), the server sends a `configure` payload containing the full project configuration including the resolved per-phase models:

```json
{
  "type": "configure",
  "config": {
    "id": 1,
    "name": "My Project",
    "execution_model": "anthropic/claude-3-5-sonnet",
    "blueprint_model": "anthropic/claude-3-5-sonnet",
    "review_model": "anthropic/claude-3-5-haiku",
    "documentation_model": "anthropic/claude-3-5-sonnet",
    ...
  }
}
```

This ensures the orchestrator passes the correct model identifiers to agent containers for each phase of the lifecycle.

The configure message is built in `server.ts:handleOrchestratorConnection()` by spreading the project object and overriding the model fields with their resolved values from `getProjectModels()`.

---

## 3. WebSockets Layer (`src/api/server.ts`)

The Express server initializes two primary WebSocket Server systems running alongside standard HTTP traffic:

### A. Upward Orchestrator Endpoint (`/api/orchestrator/ws`)
- **Purpose**: Registers active orchestrators dialing in.
- **Message Flow**:
  - Registers the client to its respective `projectId`.
  - Dispatches project configurations via a `configure` payload on connection.
  - Receives `ready` triggers from the orchestrator requesting jobs. The backend queries SQLite, topologically sorts active jobs, and yields next jobs only if all their prerequisite tasks listed in `depends_on` are marked `COMPLETED` and the orchestrator has free execution slots.
  - Receives log updates and stage updates (`job_update`) from running agent containers, updates the SQLite `jobs` table, and forwards them to the active browsers.

### B. Frontend Streaming Endpoint (`/ws?projectId=X`)
- **Purpose**: Feeds live terminal outputs to project execution dashboards.
- **Message Flow**:
  - Registers client browsers subscribing to project rooms.
  - Fans out log events and database updates (`job_update`, `chat_updated`) to browser sockets in real time.

---

## 4. Repository Validation & URL Generation (`src/api/routes/projects.ts`)

The `POST /projects/validate` endpoint validates repository configuration including git remote accessibility. The `generateFinalRepoURL()` helper constructs authenticated URLs for git ls-remote operations.

### Host-Specific Authentication

| Host | Username | Password | Use Case |
|------|----------|----------|----------|
| `bitbucket` | `x-token-auth` | PAT | Bitbucket Cloud/Server authentication |
| `github` | `token` | PAT | GitHub.com authentication |
| `gitea` | `token` | PAT | Gitea self-hosted instances |
| `azure-devops` | `token` | PAT | Azure DevOps Git repositories |

### Function Signature

```typescript
export function generateFinalRepoURL(repoUrl: string, repoPat: string, repoHost: string): string
```

### Validation Flow (`/projects/validate` with `step: 'repo'`)

1. Client sends `repo_url`, `repo_pat`, and `repo_host` in request body
2. `generateFinalRepoURL()` constructs authenticated URL using host-specific username
3. `git ls-remote <authenticated_url>` is executed with 10-second timeout
4. Returns `{ success: true }` if remote is reachable, 400 error otherwise

```typescript
case 'repo': {
  if (repo_url) {
    const finalUrl = generateFinalRepoURL(repo_url, repo_pat || '', repo_host || 'github');
    try {
      execFileSync('git', ['ls-remote', finalUrl], { stdio: 'ignore', timeout: 10000 });
      return res.json({ success: true });
    } catch {
      return res.status(400).json({ error: 'Repository access failed' });
    }
  }
}
```

### Error Handling

- Empty/null PAT returns original URL unchanged (public repository)
- Malformed URLs are returned as-is without modification
- Git ls-remote timeout (10s) triggers validation failure
