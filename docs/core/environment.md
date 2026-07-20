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
| (project field) `docker_image_tester` | `openvelo-tester:linux` | Stored in `projects.docker_image_tester`; validated by `POST /api/projects/validate?step=docker_tester`; used by the orchestrator when `jobs.type = 'test'` (passed via `applyProjectConfig()` → `cfg.DockerImageTester`). |
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
| `DOCKER_IMAGE_TESTER` | `openvelo-tester:linux` | Tester image to spawn when `jobs.type === 'test'`. Overridden on a per-project basis by `projects.docker_image_tester` (kept in `applyProjectConfig()` if the field is added). |
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
| `REPO_PATH` | `/repo` (Linux) or `C:\repo` (Windows) | Where to mount the repo via GBFS. |
| `MAX_RETRIES` | `3` | Agent-internal retry cap. |
| `AGENT_MAX_RETRIES` | (fallback for `MAX_RETRIES`) | Same as above. |
| `MAX_TIMEOUT` | `1800000` | Legacy fallback for `AGENT_MAX_TIMEOUT`. **The agent no longer hard-kills turns on this value** — the orchestrator's inactivity watchdog (`wss.ts:resetInactivityTimer`) is the sole safety net. The value is now plumbed into the agent for telemetry. |
| `AGENT_PLATFORM` | auto-detected | Path resolution switch for a genuine native-Windows container (`REPO_PATH` becomes `C:\repo`). |
| `AGENT_RUNTIME` | `linux` | Tool-engine execution runtime. `wine` (set by `Dockerfile.wine`) runs `kilo acp` and its child toolchain under Wine using the Windows Node/npm environment, while the wrapper stays native Linux. See the Wine runtime note below. |
| `USERPROFILE` | (none) | Windows home dir. |

### Wine runtime (`AGENT_RUNTIME=wine`)
The `openvelo-agent:wine` image (built from `components/agent/Dockerfile.wine`) is a **Linux** container. The Node wrapper runs natively (`node-linux`) and does all git/fs work on Linux paths, but the tool engine (`kilo acp`) and everything it shells out to (`node`, `npm`, `npx`, `dotnet`, `git`, `python`, `pwsh`) run under Wine via the shims in `components/agent/shims/`.

**Windows toolchain in Wine.** The image installs Windows builds under `/opt/*-win` and puts them on the Wine registry `PATH` (`HKCU\Environment`): Node 20.15.1 (`node-win`), **.NET SDK 10.0.302** (`dotnet-win`), **Git for Windows / MinGit 2.55.0.3** (`git-win`, both `cmd\` and `mingw64\bin\` on `PATH`), Python 3.11.9 (`python-win`), PowerShell 7.2.21 (`powershell-win`). The Wine git is configured with `core.autocrlf=false`, `core.eol=lf` and `safe.directory=*` so it does not rewrite line endings or reject the shared `/repo == C:\repo` checkout that the wrapper's Linux git also touches.

**.NET 10 under Wine.** The build sets `WINEDLLOVERRIDES="mscoree,mshtml="` (mscoree disabled) so `wineboot`/Wine-Mono install stays non-interactive. That disabled mscoree breaks the .NET 10 CoreCLR (`mscoree.dll not found` while loading `System.Runtime.dll`), so the image flips it back to Wine's builtin at runtime via `WINEDLLOVERRIDES="mscoree=b;mshtml="`, which lets `dotnet` (10.0.302) and `git` run under Wine.

Wine needs a valid `C:\` working directory, so the image maps the Linux work/bind-mount dirs into `drive_c` with symlinks (the real `drive_c` — `C:\windows`, `C:\users`, kilo AppData — is preserved):

```
C:\repo   == /repo      C:\SKILLS == /SKILLS   C:\data == /data
C:\tmp    == /tmp        C:\root   == /root
```

The wrapper keeps using the Linux paths; every string handed to the engine (the ACP session `cwd`, `<environment_details>`, and all prompt path placeholders) is converted to the Windows form via `toAgentPath()` in `config.ts`. Because `C:\… == /…`, files the wrapper writes/reads (`/tmp/VERDICT`, the plan, `REVIEW.json`) are the same files the engine sees at `C:\…`.

**ACP transport (Wine bridge).** `kilo.exe` is a Bun-compiled Windows binary. Under Wine it **cannot** read a Unix pipe or socket as a std handle — it crashes with `EBADF: bad file descriptor, open` — and on a TTY it starts an interactive TUI instead of speaking ACP. So the wrapper does **not** spawn `kilo acp` over stdio in Wine mode. Instead (`useWineBridge` in `acp-client.ts`):

1. The wrapper opens an ephemeral loopback TCP server and spawns `wine node.exe wine-acp-bridge.cjs <port> C:\repo <kilo.exe>` (`components/agent/shims/wine-acp-bridge.cjs`).
2. The bridge (running under the Windows Node) spawns `kilo.exe acp --cwd C:\repo` with `stdio: 'pipe'` — those are native **Win32** pipes, which kilo reads without EBADF — and relays the newline-delimited JSON-RPC stream between kilo's stdio and the TCP socket.
3. `JsonRpcClient` speaks ACP over that socket exactly as it would over child stdio (the socket is adapted to the same transport shape).

The bridge, Windows Node, and kilo binary paths are set in `Dockerfile.wine` via `WINE_ACP_BRIDGE`, `WINE_NODE_EXE`, `KILO_WINDOWS_EXE` (all overridable env). In native/Linux mode (`AGENT_RUNTIME=linux`) the bridge is bypassed and `kilo acp` is spawned directly over stdio as before.

### Sub-derived constants (not env)
- `STORY_PATH` = `/tmp/story.md` (always).
- `HOME_DIR` = `process.env.USERPROFILE || 'C:\\Users\\ContainerAdministrator'` on Windows, `/root` on Linux.

## Tester (`components/tester/src/config.ts`)

All read at startup into the static `CONFIG` object, then **overridden** by `applyHandshake()` when the orchestrator's `TesterHandshakeConfig` arrives (see [../components/tester.md](../components/tester.md) §2).

| Env Var | Default | Purpose |
|---------|---------|---------|
| `TESTER_PORT` | `3001` | WebSocket server port inside the tester container (matches the agent's `AGENT_PORT` — both speak the same wire format). |
| `TESTER_DEBUG` | `false` | When `'true'`: run `setup` only, then park the container with a keepalive HTTP server on `TESTER_PORT` (manual inspection via `docker exec`). No orchestrator handshake is expected. |
| `REPO_URL` / `REPO_HOST` / `REPO_PAT` | (empty / `github` / empty) | Authenticated git URL credentials — usually overridden by handshake. |
| `REPO_BRANCH` | (empty) | Branch to check out (the staging branch from the handshake). |
| `REPO_PATH` | `/repo` | Where to mount inside the container via GBFS. |
| `BACKEND` / `BACKEND_MODEL` | `kilo` / (empty) | LLM backend + execution model. |
| `BUILD_CMD` / `TEST_CMD` | (empty) | Project-level cmds from `applyProjectConfig`. |
| `TEST_PLAN` | (empty) | The full test plan markdown handed to the tester (rendered into `prompts/test_plan.md` as `{{TEST_PLAN}}`). Overridden by handshake. |
| `JOB_ID` | `'0'` | Logical job id used in WS payloads. |
| `JOB_TITLE` | (empty) | Job title (overridden by handshake). |
| `AGENT_MAX_TIMEOUT` | `1800000` | Read but plumbed through for telemetry; the orchestrator's inactivity watchdog is still the only enforcement. |
| `PORT_VNC` | `5900` | Host-published x11vnc port the web-ui VNC proxy bridges to. |
| `DISPLAY` | `:99` | X11 display number (Xvfb target). |
| `SCREEN_W` / `SCREEN_H` | `1280` / `720` | Virtual screen size. |
| `MCP_HOST` / `MCP_PORT` | `127.0.0.1` / `8123` | Host the Python accessibility-controller MCP server binds to. |
| `MCP_TRANSPORT` | `http` | Transport for the controller — `http` (FastMCP at `/mcp`) or `sse` (FastAPI SSE at `/sse`). |
| `VERDICTS_DIR` | `/tmp/verdicts` | Where per-entry verdict files (one JSON per plan entry, `<index>.json`) are written by step 1b and consumed by the verdict stage. |
| `VERDICT_PATH` | `/tmp/TEST_VERDICT.json` | Final aggregated verdict written by `runVerdict()` via `verdict_system.md`; consumed by `verifier.readVerdict()`. |

### Sub-derived constants (not env)
- The tester also reads `USERPROFILE` / `HOME` for repo path resolution and inherits the agent's `STORY_PATH` = `/tmp/story.md`.

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
