# OpenVelo Architecture

This folder contains the architectural domain documentation for the OpenVelo project. These documents guide OpenVelo's agents (and other developers) on the architectural constraints and conventions of this repository.

| Domain | Description | File |
|--------|-------------|------|
| **Web UI** | The frontend React SPA (Vite, Tailwind, Radix UI) and Express.js backend for project management and planning. | [components/web-ui.md](components/web-ui.md) |
| **Web UI Subsystems** | Auth, models registry, uploads, themes, settings, hooks, and supporting lib utilities. | [components/web-ui-subsystems.md](components/web-ui-subsystems.md) |
| **Orchestrator** | The Node.js process responsible for managing agent Docker containers and forwarding logs via WebSocket. | [components/orchestrator.md](components/orchestrator.md) |
| **Agent** | The containerized AI execution loop. | [components/agent.md](components/agent.md) |
| **Pipelines** | Execution pipelines, dependency model, and the retry architecture. | [core/pipelines.md](core/pipelines.md) |
| **Planning Workflows** | The database-driven `collecting` stage state machine. | [core/planning-workflows.md](core/planning-workflows.md) |
| **Web UI State Machine** | Reference of all 9 chat stages and their substages. | [core/web-ui-state-machine.md](core/web-ui-state-machine.md) |
| **Authentication** | Users, groups, JWT, session secret, middleware, password policy. | [core/auth.md](core/auth.md) |
| **Environment Variables** | All env vars across the three components. | [core/environment.md](core/environment.md) |
