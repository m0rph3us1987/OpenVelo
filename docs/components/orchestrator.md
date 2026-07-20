# Orchestrator Architecture

The `orchestrator` is a Go daemon that manages agent Docker containers and functions as a real-time message bridge between the Web-UI and isolated Agent containers.

## 1. Directory Structure & Key Files
- `internal/`:
  - `main.go` — Entry point. Connects to the Web-UI via `wsclient`, registers a single `onMessage()` handler that **dispatches on the `type` field** (`configure` / `job_list` / `pause` / `resume` / `shutdown` / `stop_job` / `hello`), and runs a polling loop. Also installs signal handlers.
  - `wsclient/` — **Upward WebSocket Client** to the Web-UI. Manages the outbound socket to `/api/orchestrator/ws?projectId=...` with exponential-backoff reconnect (`min(1000 * 2^n, 30_000)` ms). On `open` it sends `hello`. Exposes `send()`, `getNextJobs(count)`, and an `onMessage()` registry. **It does not interpret message types itself** — that happens in `main.go`.
  - `agentws/` — **Downward WebSocket Manager to Agents**. Dials *into* the agent's WebSocket server inside each spawned container. Retries up to 10× at 1 s, sends the initial `handshake`, forwards agent `log` / `stage` / `finish` to the Web-UI as `log` / `job_log_chunk` / `job_update`, and implements the inactivity watchdog (see §3).
  - `docker/` — **Docker Engine Wrapper** for spawning **agent** containers. Uses the Docker API. Resolves the orchestrator's own Docker network and joins the agent to it. Auto-detects Linux vs Windows agent images for path resolution.
  - `workflow/` — Per-job state machine. Holds `activeContainers` (jobId → containerId) and `jobsInProgress` (jobId set). `processSingleJob(job)` notifies the Web-UI, spawns the agent container, then awaits `connectToAgent()` which keeps the `activeContainers` entry populated for the full job lifetime.
  - `config/` — Static `CONFIG` (env-var driven) + `generateFinalRepoURL()` + `applyProjectConfig()`.

## 2. Communication Pipeline

The orchestrator uses two separate WebSockets. It is **pull-based on the upward side**: every 1 s it asks the Web-UI for `get_next_jobs` until it reaches `max_parallel_jobs`. The Web-UI's `job-scheduler.ts` `assign_job` push path is dual-mode/legacy; the active dispatch path is pull.

```
  ┌────────────────┐              ┌────────────────┐              ┌────────────────┐
  │     Web UI     │              │  Orchestrator  │              │  Agent | Test  │
  │ (Express WSS)  │              │ (Host Service) │              │  (Container)   │
  └───────┬────────┘              └───────┬────────┘              └───────┬────────┘
          │  hello                          │                               │
          ├──────────────────────────────►│                               │
          │  configure (project config)     │                               │
          │◄──────────────────────────────┤                               │
          │  ready                          │                               │
          ├──────────────────────────────►│                               │
          │  get_next_jobs (every 1 s)      │                               │
          ├──────────────────────────────►│                               │
          │  job_list                       │                               │
          │◄──────────────────────────────┤                               │
          │                                │  docker run                   │
          │                                ├──────────────────────────────►│
          │                                │  WS connect (retry x10)      │
          │                                ├──────────────────────────────►│
          │                                │  handshake (configs + story) │
          │                                ├──────────────────────────────►│
          │                                │◄──────────────────────────────┤
          │  log / job_log_chunk           │  log (real-time stream)      │
          │◄──────────────────────────────┼───────────────────────────────┤
          │  job_update                    │  stage / finish              │
          │◄──────────────────────────────┼───────────────────────────────┤
          │                                │  docker rm (clean up)        │
          │                                ├──────────────────────────────►│
```

## 3. Container Configuration

- **Network**: Resolves the orchestrator's own Docker network via `resolveNetworkMode()` (uses `HOSTNAME`, inspects self, reads `NetworkSettings.Networks[0]`) and joins the agent to **that same network**. The agent is then reachable at `ws://<container_name>:3001`. **Not** the host's host network.
- **Image selection (per job kind)** — `workflow/job_runner.go:63-75` derives `jobKind` from `job.type === 'test'`; `spawnImage = job.dockerImage || (jobKind=='tester' && cfg.DockerImageTester) || cfg.DockerImage`. Tester jobs therefore pull `cfg.DockerImageTester` (default `openvelo-tester:linux`) instead of the agent image.
- **Tester dispatch** — `job_runner.go:117-121` switches on `jobKind`: tester jobs call `agentws.ConnectToTester` (sends a `TesterHandshakeConfig` with `repo_branch` + `test_plan`, see [tester.md](tester.md) §2), agent jobs call `agentws.ConnectToAgent`. Both share `runJobWebSocket` (`agentws/conn.go:87-365`). Tester spawn also surfaces a `vncHostPort` to the Web-UI in the `job_update` payload (`job_runner.go:106-108`), which the web-ui latches into `jobs.vnc_host_port` and serves via the `/api/vnc/:jobId` proxy (`web-ui/server.ts:586-...`).
- **Port Mapping**: Dynamically finds a free host port via `net.createServer().listen(0, ...)` and binds it to port `3001` inside the agent container. In container mode, the orchestrator dials the agent by container name on the internal port.
- **Volume Mounts** (only three — the repository is **not** mounted):
  - `~/.local/share/kilo/auth.json` → `/root/.local/share/kilo/auth.json` (or `C:/Users/ContainerAdministrator/.local/share/kilo/auth.json` on Windows containers).
  - `~/.config/kilo` → `/root/.config/kilo`.
  - `OPENVELO_SKILLS_HOST_PATH` → `/SKILLS` (Windows: `C:/SKILLS`).
- **Extra hosts**: `host.docker.internal:host-gateway` for non-Windows containers.
- The agent mounts the repository itself via GBFS during `prepareRepository()` using the authenticated URL passed in `handshake`.

## 4. Inactivity Watchdog

`wss.ts:resetInactivityTimer()` resets a `setTimeout(handleInactivityTimeout, CONFIG.AGENT_MAX_TIMEOUT)` on every received agent message. If the window expires:

1. Send `checkpoint` to the agent.
2. Wait up to 60 s for `checkpoint_done`.
3. Close the WS.
4. Send `job_retry` to the Web-UI.

`checkpointAllAgents()` (used during `shutdown` and on SIGTERM/SIGINT) sends `checkpoint` to every active agent and waits 60 s for `checkpoint_done` per agent.

## 5. Repository URL Generation (`src/config.ts:generateFinalRepoURL`)

`generateFinalRepoURL(repoUrl: string, repoPat: string, repoHost: string): string` is **host-aware** (third argument required). Two patterns are emitted:

| `repoHost` | Username | Password |
|------------|----------|----------|
| `bitbucket` | `x-token-auth` | PAT |
| `github` / `gitea` / `azure-devops` / (default) | `token` | PAT |

Returns the original URL unchanged if `repoPat` is empty or the URL is malformed. (The pre-kilo-migration two-arg overload has been removed; the web-ui's `generateFinalRepoURL` mirrors the same signature.)

## 6. `applyProjectConfig()` (called on `configure` message)

Copies the Web-UI's project config into the orchestrator's `CONFIG`:
```typescript
CONFIG.REPO_URL          = generateFinalRepoURL(project.repo_url, project.repo_pat ?? '', project.repo_host);
CONFIG.REPO_HOST         = project.repo_host || 'github';
CONFIG.REPO_PAT          = project.repo_pat ?? '';
CONFIG.BACKEND           = project.backend;
CONFIG.BACKEND_MODEL     = project.execution_model ?? '';
CONFIG.BACKEND_BLUEPRINT_MODEL    = project.blueprint_model ?? '';
CONFIG.BACKEND_REVIEW_MODEL       = project.review_model ?? '';
CONFIG.BACKEND_DOCUMENTATION_MODEL= project.documentation_model ?? '';
// + DOCKER_IMAGE, BUILD_CMD, TEST_CMD, STAGING_BRANCH, POLL_INTERVAL,
//   AGENT_MAX_TIMEOUT, MAX_PARALLEL_JOBS, MAX_RETRIES, AGENT_MAX_RETRIES,
//   REMOVE_DELETED_CONTAINERS, PROJECT_ID
```

## 7. SIGTERM/SIGINT

`shutdown()` sets paused/shutting-down flags, calls `checkpointAllAgents()` to flush in-progress work, calls `stopAllContainers()`, and `process.exit(0)`. The Web-UI's `handleOrchestratorDeath()` detects the disconnect and resets RUNNING jobs to PENDING.
