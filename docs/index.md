# OpenVelo Architecture

This folder contains the knowledge bundle for the OpenVelo project, adhering to the Open Knowledge Format (OKF). These documents guide OpenVelo's agents (and other developers) on the constraints and conventions of this repository.

| Domain | Description | File |
|--------|-------------|------|
| **Web UI** | The frontend React SPA (Vite, Tailwind, Radix UI) and Express.js backend for project management and planning. | [components/web-ui.md](components/web-ui.md) |
| **Web UI Subsystems** | Auth, models registry, uploads, themes, settings, hooks, and supporting lib utilities. | [components/web-ui-subsystems.md](components/web-ui-subsystems.md) |
| **Web UI — Mobile Layer** | Mobile/tablet detection (`useIsMobile`), lazy-loaded mobile views, and the `MobileRoutes` branch in `SecurityRouter`. | [components/web-ui-mobile.md](components/web-ui-mobile.md) |
| **Orchestrator** | The Go process responsible for managing agent Docker containers and forwarding logs via WebSocket. | [components/orchestrator.md](components/orchestrator.md) |
| **Agent** | The containerized AI implementation loop (setup → blueprint → implement → test → review → document → push). | [components/agent.md](components/agent.md) |
| **Tester** | The containerized AI QA loop for `jobs.type = 'test'`: setup → plan → per-entry execute → verdict, driving a real X11 desktop via an MCP accessibility controller. | [components/tester.md](components/tester.md) |
| **GBFS** | A FUSE filesystem exposing a git branch as a mountable directory, used for instantly mounting repositories into agent containers instead of cloning. | [components/gbfs.md](components/gbfs.md) |
| **Pipelines** | Execution pipelines, dependency model, and the retry architecture. | [core/pipelines.md](core/pipelines.md) |
| **Planning Workflows** | The database-driven `collecting` stage state machine. | [core/planning-workflows.md](core/planning-workflows.md) |
| **Web UI State Machine** | Reference of all 9 chat stages and their substages. | [core/web-ui-state-machine.md](core/web-ui-state-machine.md) |
| **`requirement` Chat Mode** | The fourth chat mode: upload a `.md` requirement doc, skip `collecting`, land at `requirement/requirement`. | [core/requirement-mode.md](core/requirement-mode.md) |
| **Authentication** | Users, groups, JWT, session secret, middleware, password policy. | [core/auth.md](core/auth.md) |
| **Environment Variables** | All env vars across the components (web-ui, orchestrator, agent, tester). | [core/environment.md](core/environment.md) |
