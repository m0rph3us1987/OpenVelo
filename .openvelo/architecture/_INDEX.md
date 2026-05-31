# OpenVelo Architecture

This folder contains the architectural domain documentation for the OpenVelo project. These documents guide OpenVelo's agents (and other developers) on the architectural constraints and conventions of this repository.

| Domain | Description | File |
|--------|-------------|------|
| **Web UI** | The frontend React SPA (Vite, Tailwind, Radix UI) and Express.js backend for project management and planning. | [components/web-ui.md](components/web-ui.md) |
| **Orchestrator** | The Node.js process responsible for managing agent Docker containers and forwarding logs via WebSocket. | [components/orchestrator.md](components/orchestrator.md) |
| **Agent** | The containerized AI execution loop (Setup → Blueprint → Implement → Test → Review → Push). | [components/agent.md](components/agent.md) |
| **Pipelines** | Documentation covering the Execution pipelines, dependency models, and retry logic. | [core/pipelines.md](core/pipelines.md) |
| **Planning Workflows** | Deep dive into the database-driven state machine and UI integration of planning workflows. | [core/planning-workflows.md](core/planning-workflows.md) |
