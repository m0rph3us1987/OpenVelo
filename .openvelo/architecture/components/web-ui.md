# Web UI & Express API Architecture

The `web-ui` component is the central orchestration cockpit: a frontend React SPA (Vite, Tailwind, Radix UI) and an Express.js backend running on Node.js.

## 1. Directory Structure & Key Files
- `src/` (frontend SPA, Vite):
  - `pages/` — `HomePage`, `LoginPage`, `PlanPage`, `ProjectPage`, `ChangePasswordPage`.
  - `components/plan/` — per-stage chat UIs (`ChatCollecting`, `ChatDomain`, `ChatPlan`, `ChatRequirement`, `ChatUserstory`, `ChatVerify`, `ChatList`, `ChatInit`, `ChatAnalysis`, `ChatFinalAssessment`, `ChatRequirementUpload`, `ParallelLogViewer`, etc.). `ParallelLogViewer` streams live stdout/stderr from multiple in-flight agent containers in the planning view. `ChatRequirementUpload` is mounted by `PlanPage`'s mode-aware `STAGE_DISPATCH` for the `requirement` mode's upload substage (see [../core/requirement-mode.md](../core/requirement-mode.md)).
  - `components/{auth,dashboard,layout,models,projects,settings,theme,ui}/` — supporting UI (see [web-ui-subsystems.md](web-ui-subsystems.md) for the full inventory).
  - `hooks/` — 8 custom state hooks: `useChatListWebSocket`, `useChatWebSocket`, `useJobWebSocket`, `useProjectStatus`, `useStageWebSocket`, `useTheme`, `useWebSocket`, `useWorkItems`.
  - `context/` — `AuthContext`, `ToastContext`.
  - `types/express.d.ts` — Express type augmentation for `req.user`.
- `src/api/` (backend):
  - `server.ts` — HTTP + WebSocket server (default port 3000). Owns both `wss` (frontend clients) and `orchWss` (orchestrator client) `noServer: true` upgrade handlers, heartbeat, and the orchestrator message dispatcher.
  - `router.ts` — top-level Express router. Mounts sub-routers and hosts the top-level `POST /chatCreate`, `POST /chatOpen`, `POST /chatDelete` endpoints.
  - `routes/` — `auth.ts`, `chats.ts`, `domains.ts`, `groups.ts`, `models.ts`, `plan.ts`, `projects.ts`, `settings.ts`, `themes.ts`, `uploads.ts`, `users.ts`. **Job endpoints are nested under `routes/projects.ts` as `/:id/jobs/...`** — there is no `routes/jobs.ts`.
  - `middleware/auth.ts` — `requireAuth`, `requireAdmin`, `requireProjectAccess`.
- `src/lib/` — core utilities (see [web-ui-subsystems.md](web-ui-subsystems.md)).
- `prompts/` — 12 markdown prompt templates (see [web-ui-state-machine.md](../core/web-ui-state-machine.md) for the mapping). The `plan` stage was reorganised in the kilo migration from per-entity Epic/Feature/Story prompts into a job-discovery → orchestrator → runner trio.

## 2. Database Schema (`src/lib/db.ts`)

SQLite (`better-sqlite3`) with WAL mode and foreign keys enabled.

```
   ┌────────────────┐         ┌────────────────┐
   │     users      │ 1───N   │ group_members  │ N───1   ┌────────────┐
   └────────────────┘         └────────────────┘◄────────│   groups   │
                                                        └─────┬──────┘
                                                              │ 1
                                                              │ N
                                                     ┌────────▼──────┐
   ┌────────────────┐ 1     N    ┌────────────────┐ N      │group_projects│
   │    projects    │───────────►│     jobs       │        └──────────────┘
   └───────┬────────┘            └────────────────┘
           │ 1
           │ N
   ┌───────▼──────────┐ 1     N   ┌──────────────────┐
   │  chat_sessions   │──────────►│  chat_messages   │ 1───1 ┌───────────────────────┐
   │  (mode, stage,   │           └──────────────────┘◄─────│chat_message_options   │
   │   sub_stage,     │                                     └───────────────────────┘
   │   sub_stage_pre_ │
   │   error,         │  Global:
   │   error_type,    │    ┌──────────────────┐
   │   running)       │    │  ui_settings     │  (theme, app_title, debug_sse_console, security_enabled)
   └──────────────────┘    └──────────────────┘
                              ┌──────────────────┐
                              │     models       │  (provider, model_name)
                              └──────────────────┘

   Per-session tables: domains / domain_questions / domain_answers
                       requirement_outline / requirement_section
                       plan_epics / plan_features / plan_stories
```

- **`projects`** — name, port, repo host/url/PAT, docker image, backend, **nine per-phase model fields** (§3), build/test commands, staging branch, poll interval, agent timeout, parallel/retries limits, remove-deleted-containers flag, status, pid.
- **`jobs`** — execution row. `depends_on` is a JSON array of predecessor job IDs; `feature_id` references `plan_features.id`; `container_id`, `branch`, `retry_count`, `runtime`, `agent_attempt` / `agent_max_retries` reflect live in-flight state. (The pre-kilo `acceptance_criteria` column was dropped in favour of `feature_id`.)
- **`chat_sessions`** — `mode` (`plan`/`quick`/`verify`/`requirement`), `stage`, `sub_stage`, `sub_stage_pre_error` (saved on every non-error transition so retry endpoints can resume), `error_type` (set on `error` sub_stage), `running` (single-runner lock). The `requirement` mode was added with an in-place CHECK-constraint migration (see [../core/requirement-mode.md](../core/requirement-mode.md)).
- **`chat_messages`** + **`chat_message_options`** — full transcript (role `user`/`system`) + LLM `options` JSON.
- **`domains`/`domain_questions`/`domain_answers`** — domain outline + Q&A state.
- **`requirement_outline`/`requirement_section`** — hierarchical requirement text. `requirement_outline` carries `status` + `logs` columns for live per-row progress streaming.
- **`plan_epics`/`plan_features`/`plan_stories`** — planning tree (kept for backwards compatibility with old chats).
- **`plan_jobs`** — new (kilo-era) flat job backlog produced by the `plan` stage. Columns: `job_index`, `title`, `description`, `requirement_line_mapping`, `content`, `build_cmd`, `test_cmd`, `status` (default `'pending'`), `logs`, plus a `UNIQUE(chat_id, job_index)` constraint.
- **`models`** — global registry populated by `POST /api/models/refresh`.
- **`ui_settings`** — key/value bag.
- **`users`/`groups`/`group_members`/`group_projects`** — auth/ACL. See [../core/auth.md](../core/auth.md).

## 3. Model Specialization (`getProjectModels()`)

The `projects` table stores **nine** model fields:

| Field | Purpose | Fallback |
|-------|---------|----------|
| `default_model` | Primary identifier | (required) |
| `execution_model` | Agent implementation | `default_model` |
| `blueprint_model` | Agent architecture/blueprint | `default_model` |
| `analyzer_model` | Code analysis (planning stages) | `default_model` |
| `chat_model` | Planning conversational AI | `default_model` |
| `requirement_model` | Requirements elicitation | `default_model` |
| `planning_model` | Story breakdown & estimation | `default_model` |
| `review_model` | Agent code review | `default_model` |
| `documentation_model` | Agent documentation | `default_model` |

`getProjectModels(projectId)` resolves all nine, substituting `default_model` for any unset. The `models` table gates project startup: `POST /api/projects/:id/start` validates that any non-default value for `blueprint_model`, `execution_model`, `review_model`, or `documentation_model` exists in `models` (else 400).

The orchestrator's `configure` payload (sent in response to its `hello` — **not** on connection) carries the four agent-side models: `execution_model`, `blueprint_model`, `review_model`, `documentation_model`. The other five live on the project row but are consumed by the web-ui's planning stages only.

## 4. WebSockets (`server.ts`)

Two `noServer: true` WebSocket servers share the HTTP `upgrade` dispatcher.

### A. Orchestrator Endpoint — `/api/orchestrator/ws?projectId=X`
No JWT auth (internal). Requires `?projectId=<id>`, else close 1008. 30 s `ws.ping()` heartbeat; missed pong → terminate + `handleOrchestratorDeath(projectId)`.

Message flow (orchestrator → server):

| Type | Server action |
|------|---------------|
| `hello` | Reset stale RUNNING jobs to PENDING, send `configure`. |
| `ready` | No-op (pull model). |
| `get_next_jobs { count }` | `getNextRunnableJobs(projectId, count)`, `setJobsRunning(jobIds)`, reply with `job_list`. |
| `job_update` | Update `jobs` (status, containerId, startedAt, stage, agentAttempt, agentMaxRetries). Broadcast on project channel. |
| `job_retry` | `incrementJobRetry()`. If > `max_retries`, mark FAILED. Else reset to PENDING and broadcast. |
| `log` | Broadcast to project room. |
| `job_log_chunk` | Broadcast to per-job channel (`WsKeys.jobKey(jobId)`). |
| `goodbye` | Reset RUNNING jobs to PENDING, remove orchestrator, broadcast `orchestrator_stopped`. |

`handleOrchestratorDeath()` resets RUNNING jobs to PENDING, removes the orchestrator, marks the project stopped, broadcasts `orchestrator_stopped`.

### B. Frontend Streaming Endpoints
- `/ws?projectId=X` — project room.
- `/ws?chatId=X` — chat room (`useChatWebSocket`).
- `/ws?jobId=X` — per-job stdout/stderr (`useJobWebSocket`).
- `/ws/stage/<stage>?chatId=X` — per-stage sub_stage channel.

All protected by `authenticateUpgrade()`. The orchestrator endpoint is exempt.

## 5. Repository Validation & URL Generation (`src/api/routes/projects.ts`)

`POST /projects/validate` runs the step named in the body:
- `name` — uniqueness check
- `port` — in-use check
- `repo` — `git ls-remote <authenticated_url>` (10 s timeout). The authenticated URL is built with the host-aware `generateFinalRepoURL` (see below), so the `repoHost` in the body is forwarded to the URL builder.
- `docker` — `docker.getImage(name).inspect()` (local image present)
- `models` — default_model exists in `models` table
- `coding` / `planning` — no-op success

`generateFinalRepoURL(repoUrl, repoPat, repoHost)` builds the authenticated URL (host-aware, three-arg signature):

| `repoHost` | Username | Password |
|------------|----------|----------|
| `bitbucket` | `x-token-auth` | PAT |
| `github` / `gitea` / `azure-devops` / (default) | `token` | PAT |

Returns the original URL unchanged if `repoPat` is empty or the URL is malformed.
