<div align="center">
  <img src="components/web-ui/public/images/logo.svg" alt="OpenVelo Logo" width="120" />
  <h1>OpenVelo: The autonomous AI engineering team</h1>
</div>

  Meet OpenVelo, your new autonomous AI engineering team. OpenVelo is an open-source, fully automated software development orchestrator that transforms how you build software—from conversational ideation
  directly to tested, production-ready Pull Requests on your Linux-based infrastructure.

  Designed for seamless integration into modern dev environments, OpenVelo bridges the gap between raw requirements and deployed code. Through an intuitive web UI, you simply chat with the system to design
  features. OpenVelo takes it from there: analyzing your repository, identifying domain requirements, and autonomously generating a structured backlog of Epics, Features, and User Stories.

  Once execution begins, OpenVelo spawns parallel, isolated AI agents within Linux Docker containers. These agents act as autonomous developers: they clone your repository, blueprint the architecture, write the
  code, and run your build and test commands. If tests fail, the agent enters a self-correcting retry loop—diagnosing errors and adjusting the implementation until all tests pass and a final AI review is
  approved. The result? A pristine Pull Request delivered directly to your GitHub, Gitea, Azure DevOps, or Bitbucket repository.

  Key Features:
   * Conversational Planning Pipeline: Go from vague ideas to rigorous REQUIREMENT.md docs and strictly ordered backlogs via an interactive, multi-phase AI chat (Analyze → Collect → Domain → Quiz → Assessment →
     Plan).
   * Autonomous Agent Execution: Linux-native containerized AI agents handle the entire coding lifecycle: Setup → Blueprinting → Implementation → Testing → AI Review → Push.
   * Self-Healing Test Loops: Agents autonomously run your existing test suites, parse the output, and iteratively fix bugs until the build passes.
   * Parallel Processing & Dependency Management: OpenVelo intelligently graphs your backlog, running independent jobs in parallel while strictly enforcing sequential execution for overlapping
      architectural changes to avoid merge conflicts.
   * Universal LLM Proxy: Bring your own model. All AI interactions are routed through Kilo, allowing you to swap out underlying LLMs for planning, analyzing, and execution. Planning stages route through a local `kilo serve` daemon REST API, while execution agents run in-container and interact with LLMs using a JSON-RPC 2.0 interface via the `kilo acp` subprocess.
   * Optimized for Linux: Built to leverage the stability and performance of Linux Docker environments for high-concurrency agent orchestration.

  Stop managing tasks and start managing outcomes. OpenVelo is open-source and ready to accelerate your repository today.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running OpenVelo](#running-openvelo)
  - [Development mode](#development-mode-recommended-for-first-use)
  - [Building Docker Images](#building-docker-images)
  - [Running in Docker — Linux / Linux-containers mode](#running-in-docker--linux--linux-containers-mode)
- [Project Configuration](#project-configuration)
- [Planning Pipeline](#planning-pipeline)
- [Execution Pipeline](#execution-pipeline)
- [Dependency Model](#dependency-model)
- [Retry Model](#retry-model)
- [Authentication & Access Control](#authentication--access-control)
- [Directory Structure](#directory-structure)
- [NPM Scripts](#npm-scripts)
- [Component Reference](#component-reference)
  - [Agent](#agent)
  - [Orchestrator](#orchestrator)
  - [Web UI](#web-ui)
  - [Tester](#tester)
  - [GBFS (Git Backed File System)](#gbfs-git-backed-file-system)
- [Guides / Tutorials](#guides--tutorials)

---

## Architecture Overview

OpenVelo consists of three components that work together. All AI interactions are routed through **Kilo** (`kilo serve`), which acts as a unified proxy to the configured LLM provider and model.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Web UI  (Vite + React SPA — port 5173 dev / 3000 production)        │
│                                                                      │
│  /projects/:id — Execute dashboard                                   │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  Job list  •  Stats  •  ActionBar (start/stop/pause)          │   │
│  │                                          ┌─────────────────┐  │   │
│  │                              [Plan] ───► │  Planning Modal │  │   │
│  │                                          │  (full-screen   │  │   │
│  │                                          │   overlay)      │  │   │
│  │                                          │  Analyze →      │  │   │
│  │                                          │  Collect →      │  │   │
│  │                                          │  Domain →       │  │   │
│  │                                          │  Quiz →         │  │   │
│  │                                          │  Assessment →   │  │   │
│  │                                          │  Req/Story →    │  │   │
│  │                                          │  Plan → Push    │  │   │
│  │                                          └─────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Express HTTP + WebSocket server (server.ts — port 3000)             │
│  • /ws?projectId=X         ← browser live-log connections            │
│  • /api/orchestrator/ws    ← orchestrator control connections        │
│  • /api/*                  ← REST API (Express routes)               │
│  • /api/auth/*             ← Authentication endpoints                │
└───────────┬──────────────────────────────┬───────────────────────────┘
            │ WS (log fan-out)             │ WS (job commands)
            ▼                              ▼ (outbound dial on startup)
    ┌───────────────┐          ┌───────────────────────────────────────┐
    │  Browser      │          │  Orchestrator  (Go)                   │
    │  (any device) │          │  • WS client — dials web-ui on start  │
    └───────────────┘          │  • Receives assign_job from web-ui    │
                               │  • Manages running agent containers   │
                               │  • Sends job_update / log back        │
                               └──────────────┬────────────────────────┘
                                              │ Docker Engine API (DooD)
                                              ▼
                               ┌───────────────────────────┐     ┌────────────────────────┐
                               │  Agent Container(s)       │◄───►│  Tester Component      │
                               │  6-phase lifecycle:       │     │  • Shared network      │
                               │  Setup → Blueprint →      │     │  • Reliable test runner│
                               │  [Implementing → Build    │     └────────────────────────┘
                               │  & Test → Review]* →      │
                               │  Documenting → Push       │
                               │                           │
                                │  AI via Kilo serve        │
                                │  ┌─────────────────────┐  │
                                │  │ kilo serve          │  │
                                │  │ → LLM provider/model│  │
                                │  └─────────────────────┘  │
                               │                           │
                               │  openvelo-agent:linux     │
                               │  or openvelo-agent:wine   │
                               └───────────────────────────┘
```

**Data flow:**

1. **Plan**: Click the **Plan** button on the project page to open the Planning modal. Chat with the AI through Analyze → Collect → Domain → Quiz → Assessment phases to produce a `REQUIREMENT.md` + structured backlog. Alternatively, you can use the Verify chat to validate and extract jobs from an existing requirements document.
2. **Push**: Send the backlog to the project with a single click.
3. **Execute**: The Web UI spawns an Orchestrator for the project (child process in dev mode, Docker container in Docker mode). The Orchestrator dials back to the web-ui via WebSocket and receives job assignments.
4. **Agent**: Each container uses GBFS to instantly mount a shared repository instead of cloning from scratch, sets up the environment, creates an architectural blueprint, implements code changes, runs build/test in a retry loop with AI review, updates architectural documentation, and opens a PR to the working branch on the configured repo host (GitHub, Gitea, Azure DevOps, or Bitbucket). Agent-side LLM calls are routed through the `kilo acp` subprocess speaking JSON-RPC 2.0. Blueprint, review, and documentation phases can each be routed to a different model via the project's **Agent Models** settings.
5. **Monitor**: The Execute dashboard streams live logs, job status, the agent's internal plan progress, token usage (input/output/cached), context window limits, and costs from the Orchestrator through the web-ui WebSocket in real time.

---

## Prerequisites

### Development mode (running from source)

| Requirement        | Notes                                                            |
| ------------------ | ---------------------------------------------------------------- |
| **Node.js v20+**   | Required for all three components                                |
| **Docker Desktop** | Must be running with Linux containers enabled |
| **Git**            | Required inside agent containers and on the host                 |
| **Kilo**           | Installed and authenticated on the host — used as the AI backend |

### Docker mode (running as containers)

| Requirement        | Notes                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| **Docker Desktop** | Linux-containers mode (Linux/macOS/WSL2) |
| **Git**            | On the host only (for cloning this repo)                                            |
| **Kilo**           | Authenticated on the host — credentials are mounted into the web-ui container       |

---

## Installation

**1. Clone the repository**

```bash
git clone <repo-url>
cd OpenVelo
```

**2. Install all dependencies** (development mode only)

```bash
npm install
```

This installs dependencies for all three components (agent, orchestrator, web-ui) via the `postinstall` script.

---

## Running OpenVelo

### Development mode (recommended for first use)

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

---

### Building Docker Images

Build all required images (Web UI, Orchestrator, and Agent):

```bash
npm run docker-build-all-linux
```

You can also build individual images — see [NPM Scripts](#npm-scripts) for all available commands.

---

### Running in Docker — Linux / Linux-containers mode

**Prerequisites:**
- Docker Desktop with Linux containers mode enabled.
- Create a `.env` file in the root directory (see `.env.example`). Set `OPENVELO_DATA_DIR` to an absolute path on your host (e.g., `/home/user/openvelo-data`).
- Kilo must be authenticated on the host — the compose file mounts `~/.local/share/kilo/auth.json` and `~/.config/kilo` into the container.
- **Note:** The web-ui container requires FUSE privileges (`/dev/fuse`, `SYS_ADMIN`) to support the new GBFS (Git Backed File System) mounts.

**Execution:**
```bash
docker compose up -d
```
Open **http://localhost:4500** in your browser.

---

## Project Configuration

All configuration is managed through the **Project Settings** dialog in the Web UI.

### General

| Setting | Description                          |
| ------- | ------------------------------------ |
| Name    | Project display name (must be unique) |

### Models

OpenVelo uses **Kilo** as a unified AI proxy. The Models tab in the project form is split into two groups: **Web-UI Models** (consumed by the planning chat) and **Agent Models** (forwarded to the orchestrator and applied inside each agent container). You can configure different LLM provider/model combinations for each stage of the pipeline. If a specific model field is left blank, it falls back to the **Default Model**.

**Web-UI Models**

| Setting             | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Default Model       | Fallback model used when a stage-specific model is not set (e.g. `anthropic/claude-sonnet-4-20250514`) |
| Analyzer Model      | Model used for repository analysis (planning stages)                                           |
| Chat Model          | Model used for planning chat conversations                                                     |
| Requirement Model   | Model used for generating requirements documents                                               |
| Planning Model      | Model used for job discovery / orchestration / runner prompts                                  |

**Agent Models**

| Setting             | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Blueprint Model     | Model used by the agent to draft `IMPLEMENTATION_PLAN.md`                                       |
| Coding Model        | Model used by the agent for code implementation (formerly the "Execution Model")                |
| Review Model        | Model used by the agent for the self-review phase                                              |
| Documentation Model | Model used by the agent to refresh `.openvelo/architecture/` docs                              |

### Repo

| Setting             | Description                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Repo Host           | Where the repository is hosted: `GitHub`, `Gitea`, `Azure DevOps`, or `Bitbucket`                  |
| Repo URL            | Git clone URL **without** an embedded token (e.g. `https://your-host.com/owner/repo.git`)         |
| Repo Token          | Personal Access Token for the repo — embedded into the URL at runtime only, never stored in the URL. For Bitbucket the PAT is sent as the password with the `x-token-auth` username; for all other hosts the PAT is sent as the password with the `token` username. |
| Repo Working Branch | Target branch for agent PRs (default: `staging`)                                                  |

### Build

| Setting       | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| Docker Image  | Image name for agent containers (default: `openvelo-agent:linux`, use `openvelo-agent:wine` for Windows executables) |
| Build Command | Command to verify implementation (e.g. `npm run build`, `dotnet build`) |
| Test Command  | Command to run tests (e.g. `npm test`, `dotnet test`)                   |

### Execution

| Setting             | Default      | Description                                                                                                                                                               |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Max Parallel Jobs   | `1`          | Max concurrently running agent containers                                                                                                                                 |
| Container Retries   | `3`          | Max times the orchestrator re-spawns a failed container                                                                                                                   |
| Agent Build Retries | `3`          | Max implement-test loops inside each agent                                                                                                                                |
| Agent Timeout       | `1800000` ms | Inactivity watchdog timeout per agent (30 min) — resets on every agent log line; fires if no output is produced for this duration, triggering a checkpoint commit and retry |
| Remove Deleted Containers | `true` | Automatically deletes successful or user-stopped containers (`docker rm -f`) to save disk space. Failed containers are preserved for debugging. |

---

## Planning Pipeline

The **Planning modal** supports two modes:

- **Requirement chat (plan)** — Full end-to-end: analyze → collect → domain plan → grill → final assessment → `REQUIREMENT.md` → Job backlog → push to project
- **Verify chat** — Upload an existing requirements document for validation and job extraction

### Phases

| Phase                | Description                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analyze**          | Performs a deep analysis of the repository, producing a `REPOSITORY.md` orientation guide covering architecture, build/test commands, coding conventions, and project structure |
| **Collect**          | Conversational phase where the AI gathers high-level requirements and goals from the user                                                    |
| **Domain**           | AI identifies domains (areas of concern) and generates targeted questions per domain to fill in details                                       |
| **Quiz**             | Verification phase — the AI challenges the collected information, looking for gaps and contradictions                                         |
| **Assessment**       | Reviews all information from prior phases, identifies remaining gaps, contradictions, missing non-functional requirements, and ambiguities. Asks one question at a time until confident all gaps are resolved |
| **Requirement**      | Generates the `REQUIREMENT.md` document from all collected information (requirement chat only)                                                |
| **Plan**             | Generates a flat **Job** backlog via a three-step prompt chain: `plan-jobs-discovery.md` (emit the list of jobs) → `plan-jobs-orchestrator.md` (per-job orchestration metadata) → `plan-jobs-runner.md` (per-job runner prompt). Evaluates `data/SKILLS/INDEX.md` to adopt relevant technology-specific rules (requirement chat only) |

---

## Execution Pipeline

Each agent runs a 7-phase workflow inside its container, driving a unified blueprinting → implementing → testing → reviewing retry loop:

```
Setup → [ Blueprinting → Implementing → Testing → Reviewing ]* → Documenting → Push
          ▲                                         │
          └─────────────── on failure ──────────────┘
```

| Phase            | Stage String     | Description                                                                                                                                             |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup**        | `setup`          | Uses GBFS to instantly mount the shared repository, creates working branches, writes `kilo.json` permissions, initializes the Kilo ACP client, checks tools, and installs them        |
| **Blueprint**    | `blueprinting`   | Evaluates the user story and repo architecture to produce a detailed `IMPLEMENTATION_PLAN.md` guiding code changes (uses `planner.txt` prompt).          |
| **Implementing** | `implementing`   | On the first attempt, sends `implementer.txt` prompt and blueprint plan. On retries, sends the original story and injected failure context.               |
| **Build & Test** | `testing`        | Runs build and test commands (uses `test.txt`). LLM writes `TEST_REPORT.json` containing verdict/error log. Failure loops back to Blueprinting.          |
| **Review**       | `reviewing`      | A fresh AI session self-reviews the diff (uses `review.txt`) and writes `REVIEW.json`. Failure loops back to Blueprinting with findings/repair hint.    |
| **Documenting**  | `documenting`    | Automatically analyzes codebase changes (uses `document.txt`), checks `.openvelo/architecture/_INDEX.md`, and updates or creates documentation.        |
| **Push**         | `pushing`        | Commits changes, rebases onto the staging branch, force-pushes, and opens a Pull Request on the repo host.                                               |

The blueprinting → implementing → testing → reviewing loop shares a single retry counter (configured via `max_retries` / `agent_max_retries`, default 3). The blueprinting and implementing stages reuse the same plan+implement session (mode-switched internally between plan and code modes) to accumulate and retain conversation history, while reviewing uses a fresh session for each attempt.

---

## Dependency Model

Jobs declare predecessor jobs via the `depends_on` field (a JSON array of job IDs). The web-ui's job scheduler enforces these dependencies — a job is only dispatched when all its predecessors are in `COMPLETED` status.

- **Flat Job Backlog with Sequential Dependencies:** The planning stage produces a flat list of jobs in the `plan_jobs` table. The `plan-dependencies.md` prompt computes a `dependencies.json` that is parsed by the backend to populate `jobs.depends_on`. Jobs are topologically sorted so dependency IDs are stable before insertion. To prevent merge conflicts and overlapping architectural changes, the planner is expected to assign sequential `depends_on` chains between jobs that touch the same artifacts, while leaving truly independent jobs dependency-free so they can run in parallel.
- **Optional Feature Grouping:** Each `jobs` row carries a `feature_id` FK back to its parent `plan_features` row (kept for backwards compatibility with chats created under the old Epic/Feature/Story flow). The feature tree (`plan_epics` / `plan_features` / `plan_stories`) is still in the schema and can be used for grouping/UI, but it is no longer the source of truth for execution order — that lives in `jobs.depends_on`.
- **Lightweight Discovery:** Dependency relationships are mapped to a `dependencies.json` file on disk parsed directly by the backend, replacing the legacy approach of generating massive LLM JSON blobs. When pushing a full backlog, jobs are topologically sorted so dependency IDs are stable before insertion.

---

## Retry Model

OpenVelo has two levels of retry:

- **Container retries** (`max_retries`, default 3): If an agent container fails or times out, the orchestrator re-spawns it. The new container receives the error history from previous attempts so it can avoid repeating the same mistakes.
- **Agent build retries** (`agent_max_retries`, default 3): Inside each container, the agent loops through blueprinting → implementing → testing → reviewing until the review passes. Any test or review failure loops back to blueprinting (re-planning) with the failure context, incrementing the retry counter. The plan+implement session is kept alive across retries to retain conversation history.
- **ACP Resilience:** If the underlying `kilo acp` process crashes or the orchestrator disconnects during execution, the workflow engine automatically restarts the process and retries the current operation, ensuring smooth recovery from transient AI or network issues.

The **agent timeout** (`agent_max_timeout`, default 30 minutes) is an inactivity watchdog — it resets on every log line from the agent. If no output is produced for the configured duration, the container is stopped, a checkpoint commit is made, and a retry is triggered.

---

## Authentication & Access Control

OpenVelo includes an optional authentication and authorization system. Security can be toggled on or off via the **Settings** page. When disabled, all requests run as a system admin user.

### Users

- **Roles**: `admin` and `user`. Admins have full access to all projects and settings. Regular users see only projects assigned to their groups.
- **Password policy**: Minimum 8 characters, must include uppercase, lowercase, number, and special character.
- **Brute-force protection**: Exponential backoff on failed login attempts (up to 30 seconds).
- **Password reset**: Admins can force a password reset for any user. Users with `password_reset_required` are prompted to change their password on login.
- **Account management**: User accounts can be disabled. The system prevents removing the last enabled admin.

### Groups

- Groups are collections of users and projects.
- A regular user can only access projects that belong to at least one of their groups.
- Admins bypass group restrictions and can access all projects.

### Authentication

- JWT-based (HS256) with httpOnly cookies.
- Session duration: 30 days.
- Endpoints: `POST /api/auth/login`, `DELETE /api/auth/logout`, `GET /api/auth/me`.

---

## Directory Structure

```
OpenVelo/
├── components/
│   ├── agent/                 # AI agent — runs inside Docker containers
│   │   ├── src/               # Agent source (TypeScript)
│   │   ├── prompts/           # Agent skill references
│   │   ├── Dockerfile         # Linux agent image
│   │   └── Dockerfile.wine    # Wine agent image (Windows executable support)
│   ├── orchestrator/          # Job orchestrator — manages agent containers
│   │   ├── internal/          # Orchestrator packages (Go)
│   │   ├── main.go            # Orchestrator entrypoint
│   │   └── Dockerfile         # Linux orchestrator image
│   ├── gbfs/                  # Git Backed File System — shared repository mounts
│   ├── tester/                # Dedicated test runner component
│   └── web-ui/                # React SPA + Express backend
│       ├── src/
│       │   ├── api/           # Express REST API routes
│       │   ├── components/    # React components
│       │   ├── contexts/      # React contexts (auth, toast)
│       │   ├── lib/           # Database, auth, types, utilities
│       │   ├── pages/         # React pages
│       │   └── prompts/       # AI system prompts for planning phases
│       └── Dockerfile         # Linux web-ui image
├── data/                      # Runtime data (SQLite DB, temp files)
├── docker-compose.yml         # Linux container deployment
├── .env.example               # Environment variable template
└── package.json               # Root monorepo scripts
```

---

## NPM Scripts

All scripts are run from the repository root.

### Development

| Script           | Description                                      |
| ---------------- | ------------------------------------------------ |
| `npm run dev`    | Start the web-ui dev server (Vite + Express, port 5173) |
| `npm run build`  | Build the orchestrator and web-ui for production |
| `npm run production` | Start the web-ui in production mode          |
| `npm test`       | Run the web-ui test suite                        |

### Docker — Linux / Wine

| Script                              | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `npm run docker-build-all-linux`    | Build all three images (agent, web-ui, orchestrator) |
| `npm run docker-image-linux`        | Build only the Linux agent image         |
| `npm run docker-image-wine`         | Build only the Wine agent image          |
| `npm run docker-image-webui-linux`  | Build only the Linux web-ui image        |
| `npm run docker-image-orch-linux`   | Build only the Linux orchestrator image  |
| `npm run docker-image-linux-no-cache` | Rebuild Linux agent image without Docker cache |

---

## Component Reference

### Agent

The agent runs inside a Docker container and executes the 6-phase workflow (Setup → Blueprint → [Implementing → Build & Test → Review]* → Documenting → Push) for a single User Story. It communicates with the orchestrator via WebSocket.

### Orchestrator

The orchestrator is a Go process that manages the lifecycle of agent containers for a single project. It:

- Connects to the web-ui via WebSocket on startup.
- Receives job assignments from the web-ui.
- Spawns agent containers via the Docker Engine API (Docker-outside-of-Docker pattern).
- Monitors container health and enforces the inactivity timeout.
- Forwards logs and status updates back to the web-ui.
- Handles container retries on failure.

In development mode, the orchestrator is built and run as a child process. In Docker mode, it runs as a dynamically spawned container on the shared `openvelo` Docker network.

### Web UI

The web-ui is a React SPA (Vite + Tailwind CSS + Radix UI) backed by an Express server. It serves as the central hub:

- **Project management**: Create, configure, and monitor projects.
- **Planning**: AI-assisted requirement gathering and backlog generation through a multi-phase conversational workflow.
- **Execution dashboard**: Start/stop/pause orchestrators, view job status, stream live agent logs via WebSocket. The planning view includes a `ParallelLogViewer` that streams stdout/stderr from multiple in-flight jobs in parallel so you can watch several agents work side by side.
- **User management**: Authentication, user accounts, groups, and role-based access control.
- **Settings**: Application-wide settings including theme customization and security toggle.
- **Database**: SQLite via `better-sqlite3` for all persistent state.
- **Orchestrator lifecycle**: Spawns and manages orchestrator processes/containers via `dockerode`.

### Tester

A dedicated test runner component that operates on the shared `openvelo` Docker network. It coordinates and executes test pipelines reliably alongside the orchestrator and agent containers.

**Test Generation & Self-Healing Flow:**
- During the planning phase, you can choose to automatically generate **test jobs** alongside your implementation jobs.
- If a test job fails during any of its tasks, the system automatically generates an **implementation job for self-healing** to diagnose and fix the issue.
- Once the self-healing job completes, the next test iteration will resume the original plan from the last failed test. This continuous testing and fixing loop ensures features are robust before completion.
- **Playwright MCP Support:** Includes built-in Playwright integration via the Model Context Protocol (MCP) to allow agents to perform robust end-to-end browser testing in a headless environment.

### GBFS (Git Backed File System)

GBFS is a FUSE-based filesystem that allows multiple agent containers to share a single, instant repository mount. Instead of performing a slow `git clone` for every new agent, GBFS mounts the repository instantly. This saves significant disk space and drastically reduces agent container startup time.

---

## Guides / Tutorials

- [Step-by-Step Guide: Plan & Build Features Autonomously](docs/tutorial01.md): A detailed, step-by-step walk-through demonstrating how to configure projects, use the interactive requirements planner, spawn the containerized orchestrator, monitor unit-testing loops, and inspect Gitea pull requests to autonomously build features inside OpenVelo itself.
