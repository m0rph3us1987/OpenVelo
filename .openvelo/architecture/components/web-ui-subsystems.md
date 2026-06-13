# Web UI Subsystems

Inventory of the secondary web-ui subsystems beyond the main project/chat/job flow documented in [web-ui.md](../components/web-ui.md). See [web-ui-state-machine.md](../core/web-ui-state-machine.md) for the full chat state machine and [auth.md](../core/auth.md) for the auth subsystem.

## Lib Utilities (`components/web-ui/src/lib/`)

| File | Purpose |
|------|---------|
| `auth.ts` | JWT sign/verify via `jose`, password policy validator. |
| `auth-service.ts` | `bcrypt.compare` wrapper, exponential login delay (`min(1000 * 2^attempts, 30_000)` ms). |
| `checkpoint.ts` | `PipelineCheckpoint` read/write to `chatDir/.pipeline-checkpoint.json`. Currently unused by stage handlers (legacy). |
| `db.ts` | SQLite schema, migrations, all data accessors. 1660 lines. |
| `docker-manager.ts` | Web-UI-side **orchestrator container** spawner. Toggled by `OPENVELO_CONTAINER_MODE`. Spawns the orchestrator as a sibling container (binds Docker socket, kilo auth/config, temp_data, skills). |
| `global-fetch.ts` | `window.fetch` override that emits `openvelo:forbidden` on HTTP 403. |
| `job-scheduler.ts` | Push-style `assign_job` dispatcher (legacy/dual-mode — the active dispatch path is the pull-based `getNextRunnableJobs`). |
| `logger-service.ts` | Per-chat `LoggerService` with `append`, `appendVerbose`, `appendRawSse`, plus per-chat subscribers. |
| `opencode-serve-client.ts` | HTTP client for the in-process `kilo serve` daemon (~660 lines; filename is legacy). Spawns the `kilo` binary, reads its `listening on http://...` line, connects SSE, and proxies `sendMessage`/`createSession`/`abortSession`/`httpGet`/`httpDelete`. Sets `KILO_YOLO=1` and `OPENCODE_YOLO=1` in the child env. |
| `opencode-serve-registry.ts` | Per-chat daemon registry with a per-stage session id map. (Legacy filename — registry now stores `kilo serve` daemons.) |
| `orch-registry.ts` | In-memory `Map<projectId, WebSocket>` + `sendToOrchestrator()` / `isOrchestratorConnected()`. |
| `session.ts` | Auto-generated JWT secret persisted to `openvelo.session` next to the DB. |
| `settings.ts` | App settings (title, security, debug SSE) + `SESSION_COOKIE`/`AUTH_MESSAGE`/`COOKIE_MAX_AGE` constants. |
| `skills.ts` | `getSkillsDir()` resolver (mirrors the agent's resolver, web-ui side). |
| `stage-ws-manager.ts` | Per-stage WebSocket fan-out (`stage:<chatId>:<stage>` channels). |
| `types.ts` | Shared TypeScript types. |
| `utils.ts` | `parseSqliteDate`, `parsePredecessorIds`, `topoSortJobs` (Kahn's algorithm). |
| `verify-session.ts` | Typed verify-mode session lifecycle (`createVerifySession`, `terminateVerifySession`, `teardownVerifySession`, `isVerifySessionHealthy`). |
| `websocket-manager.ts` | Generic project/chat/job WebSocket fan-out with namespaced keys. |
| `workflow/index.ts` | The state machine router and `transitionTo()`. |
| `workflow/stage-*.ts` | One file per chat stage (see [web-ui-state-machine.md](../core/web-ui-state-machine.md)). |

## Hooks (`components/web-ui/src/hooks/`)

| File | Purpose |
|------|---------|
| `useChatListWebSocket.ts` | Per-project chat list updates. |
| `useChatWebSocket.ts` | Per-chat updates (`chat_updated`, `sub_stage`). |
| `useJobWebSocket.ts` | Per-job log/stream subscription (live stdout/stderr). |
| `useProjectStatus.ts` | Polls orchestrator connection state. |
| `useStageWebSocket.ts` | Per-stage `sub_stage` updates. |
| `useTheme.ts` | Theme switching. |
| `useWebSocket.ts` | Generic reconnecting WebSocket. |
| `useWorkItems.ts` | Work item (job) list state. |

## Models Registry (`src/lib/db.ts` + `src/api/routes/models.ts`)

The `models` table (`provider`, `model_name`) is the gating mechanism for project startup. `POST /api/models/refresh` shells out to `kilo models` (30 s timeout), parses `provider/model` lines, prunes stale rows, and upserts new ones. `POST /api/projects/:id/start` rejects startup if any non-default value for `blueprint_model`, `execution_model`, `review_model`, or `documentation_model` is missing from the table.

## Themes (`src/api/routes/themes.ts` + `src/components/theme/`)

`GET /api/themes` lists `*.json` files in `public/themes/`, `themes/`, or `<repo>/themes/` (whichever exists first). `GET /api/themes/:name` returns the JSON. The frontend (`ThemeProvider` / `ThemeSelector`) reads `ui_settings.theme` to choose the active theme. Defaults: `dark`, `light`.

## Settings (`src/lib/settings.ts` + `src/api/routes/settings.ts`)

`AppSettings` = `{ appTitle, securityEnabled, debugSseConsole }`. Plus `theme` separately. `GET /api/settings` is public; `PUT /api/settings` is admin-only. Toggling `securityEnabled` to a new value calls `rotateSessionSecret()` (logs everyone out). Refuses to enable security with no admin.

## File Uploads (`src/api/routes/uploads.ts`)

Multer config (in `server.ts`): 5 MB max, `.md`/`.txt` only, memory storage.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/uploads/chatUpload` | POST | `requireAuth` | Save a file in `chatDir/uploads/<filename>`. |
| `/api/uploads/chatFiles` | GET | `requireAuth` | List `chatDir/uploads/`. |
| `/api/uploads/chatFile` | DELETE | `requireAuth` | Delete one uploaded file. |
| `/api/uploads/uploadOldRequirement` | POST | `requireProjectAccess` | Used by verify mode: saves `chatDir/OLD_REQUIREMENT.md` and transitions to `verify/analysis`. |

## User & Group Management

- `routes/users.ts` — admin CRUD; `PUT /me/password` for self-service.
- `routes/groups.ts` — admin CRUD; replace members/projects on PUT.

See [auth.md](../core/auth.md) for full details.

## Prompt Inventory

### `components/agent/prompts/` (6)
`setup.txt`, `planner.txt`, `implementer.txt`, `review.txt`, `document.txt`, `test.txt`.

### `components/web-ui/prompts/` (12)
- `plan-analyze.md` — stage `analyzing`
- `plan-collecting.md` — stage `collecting`
- `plan-domain.md` — stage `domain`
- `plan-requirement-outline.md` — stage `requirement/outline`
- `plan-requirement-orchestrator.md` — stage `requirement` (orchestrator shell that drives the section runner; the kilo-era replacement for the legacy section prompt)
- `plan-requirement-section-runner.md` — stage `requirement/sections`
- `plan-jobs-discovery.md` — stage `plan` (kilo-era: emits the flat job list)
- `plan-jobs-orchestrator.md` — stage `plan` (kilo-era: per-job orchestration metadata)
- `plan-jobs-runner.md` — stage `plan` (kilo-era: per-job runner prompt)
- `plan-dependencies.md` — stage `plan/dependencies`
- `plan-final-assessment.md` — stage `final_assessment`
- `verify-analysis.md` — stage `verify/analysis`

## Orchestrator-Container Spawn (`src/lib/docker-manager.ts`)

Distinct from the orchestrator's own `docker.ts` (which spawns **agent** containers). The web-ui's `dockerManager.spawnOrchestratorContainer(projectId, port, envVars)` launches the orchestrator as a sibling container when `OPENVELO_CONTAINER_MODE === 'true'`:

- Resolves the web-ui's own Docker network via `resolveNetworkMode()` and joins the orchestrator container to it.
- Bind-mounts the Docker socket (`/var/run/docker.sock` or `\\.\pipe\docker_engine`), the temp_data host path, and the kilo auth/config dirs from the host.
- On Windows containers, uses the `docker` CLI fallback (Node.js named-pipe I/O is broken with `ENOTSUP`).

`projects.ts:404-414` toggles between this and the in-process tsx spawn (`spawnOrchestratorProcess`).
