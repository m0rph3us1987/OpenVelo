# Web UI Chat State Machine

The web-ui implements a 9-stage state machine for `chat_sessions`. This document lists every stage, its substages, the prompt it loads, and how it transitions.

Stages are routed by `getHandler(stage, sub_stage)` in `components/web-ui/src/lib/workflow/index.ts`. State transitions go through `transitionTo(chatId, newStage, newSubStage, options?)`. The full state machine diagram for the `collecting` stage is in [planning-workflows.md](planning-workflows.md).

| Stage | Substages | Prompt | Handler | Notes |
|-------|-----------|--------|---------|-------|
| `init` | `''`, `'cloning'`, `'starting'`, `'error'` | (none — uses `child_process.spawn('git', ...)` and `serveRegistry`) | `stage-init.ts` | Cleans `chatDir`, `git clone`s the project repo, writes both `opencode.json` and `kilo.json` (whitelisting `/SKILLS` and `/tmp`), spawns `kilo serve`, transitions to `analyzing`. Owns its own `addPatToUrl()`. |
| `analyzing` | `''`, `'analyzing'`, `'error'` | `plan-analyze.md` | `stage-analyzing.ts` | Calls `analyzer_model`. Produces `repository/REPOSITORY.md`. Branches on `chat.mode`: `verify` → `verify/upload`; `plan` → `collecting/new`. |
| `collecting` | `''`, `'new'`, `'user'`, `'system'`, `'error'` | `plan-collecting.md` | `stage-collecting.ts` | Conversational Q&A. Uses `chat_model`. The `user`/`system` substages alternate; `ready_for_next_stage` triggers transition to `domain/plan` (or final assessment). See [planning-workflows.md](planning-workflows.md). |
| `domain` | `''`, `'plan'`, `'quiz'`, `'error'` | `plan-domain.md` | `stage-domain.ts` | Generates `domains` + `domain_questions`. `quiz` substage is a no-op stub. Transitions to `requirement` or to `final_assessment` per chat mode. |
| `requirement` | `''`, `'outline'`, `'sections'`, `'generate'`, `'requirement'`, `'error'` | `plan-requirement-outline.md`, `plan-requirement-section-runner.md`, `plan-requirement-orchestrator.md` | `stage-requirement.ts` | `outline` produces `requirement_outline` rows; `sections` produces `requirement_section` rows; `generate` writes `chatDir/REQUIREMENT.md`; terminal substage is `'requirement'`. Uses `requirement_model` (and `chat_model` for some prompts). The `plan-requirement-orchestrator.md` prompt is the orchestrator shell that drives the section-by-section runner. |
| `plan` | `''`, `'epics'`, `'features'`, `'stories'`, `'dependencies'`, `'plan'`, `'error'` | `plan-jobs-discovery.md`, `plan-jobs-orchestrator.md`, `plan-jobs-runner.md`, `plan-dependencies.md` | `stage-plan.ts` | **Job-shaped** generation (replaces the legacy per-entity `epic/feature/story` flow). `plan-jobs-discovery.md` produces the flat job list; `plan-jobs-orchestrator.md` writes per-job orchestration metadata; `plan-jobs-runner.md` produces the per-job runner prompt. JSON parse failures trigger a "corrected JSON" retry loop (`parseJsonWithRetry`). The `dependencies` step links jobs sequentially via `dependencies.json`. Uses `chat_model`/`planning_model`. |
| `final_assessment` | `''`, `'analysis'`, `'system'`, `'user'`, `'error'` | `plan-final-assessment.md` | `stage-final-assessment.ts` | Pre-plan sanity check. Uses `chat_model`. The `'user'` substage presents the assessment to the human for approval before the `plan` stage. |
| `verify` | `''`, `'upload'`, `'satisfied'`, `'analysis'`, `'error'` | `verify-analysis.md` | `stage-verify.ts` | The `verify` chat mode. `upload` waits for the user to upload `OLD_REQUIREMENT.md` (via `POST /api/uploads/uploadOldRequirement`). `analysis` runs the analyzer. `satisfied` is terminal (existing requirement already covers the ask). On unsatisfied verdict, transitions to `requirement/requirement` to write a new `REQUIREMENT.md`. All `error` transitions pass an `errorType` option (classified by `verify-error-classifier.ts`). |

## Modes

A `chat_sessions.mode` value of `'plan'`, `'quick'`, `'verify'`, or `'requirement'`. The `'requirement'` mode reuses the `verify` upload branch of the `analyzing` transition (lands at `verify/upload`) and writes a fresh `REQUIREMENT.md` (via `POST /api/chats/:chatId/upload-requirement`) before transitioning to the existing `requirement/requirement` terminal substage. The `analyzing` stage treats `requirement` the same as `verify` (`stage-analyzing.ts`).

## Retry Endpoints
Each stage with an `error` sub_stage has a corresponding retry endpoint (sets `running = false`, then `transitionTo(chat.stage, chat.sub_stage_pre_error)`):
- `POST /api/chats/:chatId/verify/retry`
- `POST /api/chats/:chatId/requirement/retry`
- `POST /api/chats/:chatId/final_assessment/retry`
- `POST /api/plan/:chatId/retry`
- `POST /api/chats/:chatId/requirement/regenerate` (full reset)
- `POST /api/plan/:chatId/regenerate` (full reset)

## Common Patterns

- **`getSkillsDir()`** — every prompt has `{SKILLS_DIR}` substituted via `getSkillsDir()` from `src/lib/skills.ts`. See [../openvelo/architecture/...](.) (Skills section in the agent doc and the `getSkillsDir` resolution rules).
- **`kilo serve` per chat** — each chat session has its own `kilo serve` daemon owned by `serveRegistry.getOrCreate(chatId, chatDir, process.env)`. (The `opencode-serve-*` filenames are kept for naming continuity, but the spawned binary is now `kilo`.) Each stage gets its own `sessionId` stored in the registry.
- **Logger service** — every stage calls `loggerService.appendVerbose(chatId, 'workflow:<stage>', ...)` and broadcasts to the chat's WebSocket room.
- **JSON parse-with-retry** — `parseJsonWithRetry(client, sessionId, resultText, modelKey, models)` (in `stage-plan.ts`) is the shared helper for the "ask the LLM to fix its JSON" loop.
