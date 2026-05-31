# Pipelines & Execution Models

## Planning Pipeline (Web UI)
The Web UI handles turning user intent into actionable tasks. It uses distinct AI prompts in the `prompts/` folder corresponding to the phases: Analyze, Collect, Domain, Quiz, Assessment, Requirement, and Plan. This results in a persisted backlog.

## Execution Pipeline (Agent)
The agent executes code in a strict loop governed by `WorkflowEngine` in `agent/src/workflow.ts`:
1. **Setup**: Clones repo, checks tools.
2. **Plan**: Formulates an implementation strategy.
3. **Implement**: Modifies code via LLM tools.
4. **Test**: Runs configured test commands. If failures occur, loops back to **Implement** up to `MAX_RETRIES`.
5. **Review**: Self-critique. If it fails, loops back to **Implement**.

## Dependency Model
- `dependencies.json` on disk determines job execution order.
- The Orchestrator polls the Web UI for jobs. The Web UI only yields jobs whose prerequisites (`depends_on`) are marked `COMPLETED`.

## Retry Model
OpenVelo implements a two-level retry architecture:
1. **Container Retries** (Managed by Orchestrator): Re-spawns failed/timed-out containers with previous error history.
2. **Agent Build Retries** (Managed by Agent): Loops inside the container (Implement → Test → Review) to autonomously fix test/build/review failures.
