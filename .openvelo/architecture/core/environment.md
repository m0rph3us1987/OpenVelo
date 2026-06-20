# Environment Variables

All env vars read by the source code, grouped by component.

## Web UI (`components/web-ui/server.ts`, `src/lib/*`, `src/api/routes/*`)

| Env Var | Default | Purpose |
|---------|---------|---------|
| `OPENVELO_DATA_DIR` | `<repo>/data` | Parent of DB + temp_data when those paths are unset. |
| `OPENVELO_DB_PATH` | `<OPENVELO_DATA_DIR>/openvelo.sqlite` | Absolute path to the SQLite DB. |
| `OLYMP_DB_PATH` | (legacy) | Used if `OPENVELO_DB_PATH` is unset. |
| `OPENVELO_TEMP_DATA_PATH` | `<OPENVELO_DATA_DIR>/temp_data` | Where chat dirs and orchestrator logs live. |
| `OLYMP_TEMP_DATA` | (legacy) | Fallback for `OPENVELO_TEMP_DATA_PATH`. |
| `OPENVELO_TEMP_DATA_HOST_PATH` | (none) | Host-side path of the temp_data volume (required for DooD). |
| `OPENVELO_SKILLS_HOST_PATH` | (none) | Host-side path to the `SKILLS/` directory. |
| `OPENVELO_CONTAINER_MODE` | `false` | When `'true'`, `POST /api/projects/:id/start` spawns the orchestrator as a sibling Docker container. |
| `OPENVELO_HOST_HOME` | (none) | Host home dir for kilo auth/config bind mounts. Falls back to `HOME` / `USERPROFILE`. |
| `PORT` | `3000` | Web-UI HTTP port. |
| `NODE_ENV` | (none) | When `'production'`, serves the Vite build output + SPA fallback. |
| `WEB_UI_URL` | `ws://localhost:3000` | Connection target passed to orchestrator. |
| `DOCKER_HOST` | (none) | Standard `docker`-style daemon address (`tcp://`/`unix://`/`npipe://`). |
| `HOSTNAME` | (none) | Self-container hostname (used to resolve the orchestrator's Docker network). |
| `COMPUTERNAME` | (none) | Windows hostname fallback. |
| `USERPROFILE` | (none) | Windows home dir. |
| `HOME` | `/root` | Unix home dir. |
| `USER` / `LOGNAME` | `root` | Used for Docker Desktop socket discovery. |

## Orchestrator (`components/orchestrator/src/config.ts`)

All read at startup into the static `CONFIG` object, then **overridden** by `applyProjectConfig()` when the web-UI sends `configure`. The three per-phase model fields (`BACKEND_BLUEPRINT_MODEL`, `BACKEND_REVIEW_MODEL`, `BACKEND_DOCUMENTATION_MODEL`) are also populated by `applyProjectConfig()`.

| Env Var | Default | Purpose |
|---------|---------|---------|
| `OPENVELO_CONTAINER_MODE` | `false` | Toggles DooD-aware network resolution and Windows CLI fallback. |
| `WEB_UI_URL` | `ws://localhost:3000` | Connection target. |
| `OPENVELO_TEMP_DATA_PATH` | `<cwd>/temp_data` | In-container temp_data path. |
| `OPENVELO_TEMP_DATA_HOST_PATH` | `OPENVELO_TEMP_DATA_PATH` | Host-side path for agent bind mounts. |
| `OPENVELO_SKILLS_HOST_PATH` | `<cwd>/data/SKILLS` (or `<parent>/data/SKILLS`) | Host-side skills dir. |
| `REPO_URL` | (empty) | Authenticated git URL — usually overridden. |
| `REPO_HOST` | `github` | Git host. |
| `REPO_PAT` | (empty) | Git PAT. |
| `BACKEND` | `kilo` | LLM backend identifier. |
| `BACKEND_MODEL` | (empty) | Execution model. |
| `BACKEND_BLUEPRINT_MODEL` | (empty) | Agent blueprint-phase model (overridden by `applyProjectConfig()` from `projects.blueprint_model`). |
| `BACKEND_REVIEW_MODEL` | (empty) | Agent review-phase model (overridden by `applyProjectConfig()` from `projects.review_model`). |
| `BACKEND_DOCUMENTATION_MODEL` | (empty) | Agent documentation-phase model (overridden by `applyProjectConfig()` from `projects.documentation_model`). |
| `DOCKER_IMAGE` | `openvelo-agent:linux` | Agent image to spawn. |
| `AGENT_MAX_TIMEOUT` | `1800000` (30 min) | Inactivity watchdog window. |
| `MAX_PARALLEL_JOBS` | `1` | Concurrency cap. |
| `MAX_RETRIES` | `3` | Container-level retries. |
| `AGENT_MAX_RETRIES` | `3` | Agent-internal retries (passed to agent). |
| `POLL_INTERVAL` | `60000` | **Read but never used** — `index.ts:122` hardcodes `setInterval(pollForJobs, 1000)`. |
| `BUILD_CMD` | (empty) | Initial build command. |
| `TEST_CMD` | (empty) | Initial test command. |
| `STAGING_BRANCH` | `staging` | Initial staging branch. |
| `REMOVE_DELETED_CONTAINERS` | `true` | `docker rm` vs `docker stop` on success/user-stop. |
| `ORCHESTRATOR_IMAGE` | `openvelo-orchestrator:linux` | Image used when the orchestrator runs as a container. |
| `DOCKER_HOST` | (none) | Docker daemon address. |
| `HOSTNAME` | (none) | Self-inspection target. |
| `COMPUTERNAME` | (none) | Windows hostname fallback. |

## Agent (`components/agent/src/config.ts`)

| Env Var | Default | Purpose |
|---------|---------|---------|
| `AGENT_PORT` | `3001` | WebSocket server port inside the container. |
| `JOB_ID` | `'0'` | Logical job identifier. |
| `REPO_PATH` | `/repo` (Linux) or `C:\repo` (Windows) | Where to clone the repo. |
| `MAX_RETRIES` | `3` | Agent-internal retry cap. |
| `AGENT_MAX_RETRIES` | (fallback for `MAX_RETRIES`) | Same as above. |
| `MAX_TIMEOUT` | `1800000` | Legacy fallback for `AGENT_MAX_TIMEOUT`. **The agent no longer hard-kills turns on this value** — the orchestrator's inactivity watchdog (`wss.ts:resetInactivityTimer`) is the sole safety net. The value is now plumbed into the agent for telemetry. |
| `AGENT_PLATFORM` | auto-detected | Path resolution switch. |
| `USERPROFILE` | (none) | Windows home dir. |

### Sub-derived constants (not env)
- `STORY_PATH` = `/tmp/story.md` (always).
- `HOME_DIR` = `process.env.USERPROFILE || 'C:\\Users\\ContainerAdministrator'` on Windows, `/root` on Linux.

## Spawn Env (set by web-ui when launching the orchestrator)

`projects.ts:spawnOrchestratorProcess` and `projects.ts:spawnOrchestratorContainer` inject:
- `PROJECT_ID` (required)
- `OPENVELO_CONTAINER_MODE` (true for container spawn)
- `OPENVELO_TEMP_DATA_PATH` (always `/openvelo/temp_data` in container mode)
- `OPENVELO_TEMP_DATA_HOST_PATH` (host-side path of the same directory)
- `OPENVELO_SKILLS_HOST_PATH`
- `OPENVELO_HOST_HOME`
- `WEB_UI_URL`
- `DOCKER_IMAGE` (agent image to spawn)
- `BACKEND`
- `BACKEND_MODEL`
- `STAGING_BRANCH`
- `MAX_PARALLEL_JOBS` (stringified)
- `MAX_RETRIES` (stringified)
- `DOCKER_HOST` (forwarded only if set on the web-ui)

The four phase-specific models (`blueprint_model`, `review_model`, `documentation_model`, plus `execution_model`) are not in the spawn env — they arrive later via the `configure` WebSocket message.
