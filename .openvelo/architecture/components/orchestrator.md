# Orchestrator Architecture

The `orchestrator` is a Node.js/TypeScript daemon that manages Docker container lifecycles and functions as a secure, real-time message bridge between the Web UI and isolated Agent containers.

---

## 1. Directory Structure & Key Files
- `src/`: TypeScript source code.
  - `index.ts`: **Entry Point**. Connects to the Web UI websocket and configures a 1-second interval loop calling `pollForJobs()`. This checks active slots and requests pending tasks from the Web UI.
  - `ws-client.ts`: **Upward WebSocket Manager**. Handles the outbound client socket dialing the Web UI Express server at `/api/orchestrator/ws`.
    - Handles incoming type `configure`: maps project rules to local variables (`applyProjectConfig()`).
    - Handles incoming type `job_list`: schedules jobs in `workflow.ts`.
    - Handles control events: `pause` (gracefully stops all running containers), `resume` (unlocks polling), `shutdown` (checkpoints and terminates), and `stop_job` (stops a single job).
  - `wss.ts`: **Downward WebSocket Client**. Despite its filename, it dials *into* the Agent's WebSocket server running inside the spawned container (`ws://<container_ip>:<dynamic_port>`).
    - Transmits the initial `handshake` block.
    - Aggregates logs and stage transitions (`sendStage`), formatting them and sending them to the Web UI via `ws-client.ts`.
    - Implements an **inactivity watchdog**. If no logs are output by the agent for `agent_max_timeout` (default 30 mins), the watchdog halts execution, issues a `checkpoint` signal to commit progress, kills the container, and initiates a container-level retry.
  - `docker.ts`: **Docker Engine Wrapper**. Employs `dockerode` to dynamically construct, network, start, and tear down Linux or Windows Agent containers.
  - `workflow.ts`: **Local Scheduler**. Tracks active job queues. Contains `processSingleJob()` which handles environment mapping, container creation, and WebSocket downward handshaking.

---

## 2. Job Dispatch & Communication Pipeline

The Orchestrator operates as a middleware multiplexer utilizing two separate WebSockets (Upward to Web UI, Downward to Agent):

```
 ┌────────────────┐              ┌────────────────┐              ┌────────────────┐
 │     Web UI     │              │  Orchestrator  │              │     Agent      │
 │ (Express WSS)  │              │ (Host Service) │              │  (Container)   │
 └───────┬────────┘              └───────┬────────┘              └───────┬────────┘
         │                               │                               │
         │   WebSocket Connect (/ws)     │                               │
         │◄──────────────────────────────┤                               │
         │                               │                               │
         │   REST / WebSocket Poll       │                               │
         │◄──────────────────────────────┤                               │
         │                               │                               │
         │  assign_job (User Story payload)                              │
         ├──────────────────────────────►│                               │
         │                               │  docker run (Volume Mounts)   │
         │                               ├──────────────────────────────►│
         │                               │                               │
         │                               │  WebSocket Connect (3001)     │
         │                               ├──────────────────────────────►│
         │                               │                               │
         │                               │  handshake (Configs/Story)    │
         │                               ├──────────────────────────────►│
         │                               │                               │
         │                               │◄──────────────────────────────┤
         │                               │  log (real-time stream)       │
         │  log (fan-out)                │                               │
         │◄──────────────────────────────┼───────────────────────────────┤
         │                               │                               │
         │                               │◄──────────────────────────────┤
         │                               │  stage ("testing", attempt 1) │
         │  job_update (WS Stage update) │                               │
         │◄──────────────────────────────┼───────────────────────────────┤
         │                               │                               │
         │                               │◄──────────────────────────────┤
         │                               │  checkpoint_done / finish     │
         │  job_completed                │                               │
         │◄──────────────────────────────┼───────────────────────────────┤
         │                               │  docker rm (Clean up)         │
         │                               ├──────────────────────────────►│
```

---

## 3. Container Configuration and Mount Bindings
Agent containers are spawned in `docker.ts` via the Docker Engine API. The Orchestrator sets up the following system configurations:

- **Network Mode**: Maps the container to the orchestrator's host network if running in containerized mode (Docker-outside-of-Docker / DooD).
- **Volume Mounts (Binds)**:
  - Mounts `~/.local/share/opencode/auth.json` to `/root/.local/share/opencode/auth.json` inside the container to provide authenticated LLM access.
  - Mounts a unique host data folder (`data/chats/{{CHAT_ID}}`) containing the cloned repository and user-uploaded verification files to `/repo` inside the container.
- **Port Mapping**: Dynamically finds a free port on the host machine using `net.createServer()` and binds it to port `3001` inside the Agent container, exposing the agent's WebSocket endpoint to the Orchestrator.

---

## 4. Repository URL Generation & Authentication (`src/config.ts`)

The `generateFinalRepoURL()` function constructs authenticated git remote URLs based on the repository host type. This is critical for git operations (clone, ls-remote, push) across different git hosting providers.

### Host-Specific Authentication Schemes

| Host | Username | Password | Example URL |
|------|----------|----------|-------------|
| `bitbucket` | `x-token-auth` | PAT | `https://x-token-auth:<PAT>@bitbucket.org/workspace/repo` |
| `github` | `token` | PAT | `https://token:<PAT>@github.com/owner/repo` |
| `gitea` | `token` | PAT | `https://token:<PAT>@gitea.example.com/owner/repo` |
| `azure-devops` | `token` | PAT | `https://token:<PAT>@dev.azure.com/org/project/_git/repo` |

### Function Signature

```typescript
export function generateFinalRepoURL(repoUrl: string, repoPat: string, repoHost: string): string
```

- `repoUrl`: Original repository URL (e.g., `https://bitbucket.org/workspace/repo_slug`)
- `repoPat`: Personal Access Token for authentication
- `repoHost`: One of `bitbucket`, `github`, `gitea`, `azure-devops`
- **Returns**: URL with embedded credentials, or original URL if PAT is empty/invalid

### Project Configuration Application (`applyProjectConfig()`)

When the orchestrator receives a `configure` payload via WebSocket, `applyProjectConfig()` calls `generateFinalRepoURL()` with the project's `repo_url`, `repo_pat`, and `repo_host` fields to construct the authenticated URL stored in `CONFIG.REPO_URL`.

```typescript
CONFIG.REPO_URL = generateFinalRepoURL(project.repo_url, project.repo_pat ?? '', project.repo_host);
CONFIG.REPO_HOST = project.repo_host || 'github';
CONFIG.REPO_PAT = project.repo_pat ?? '';
```

The authenticated URL is then used by the agent container for git operations against private repositories.
