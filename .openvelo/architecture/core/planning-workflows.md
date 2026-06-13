# Planning Workflows Architecture

This document describes how the conversational planning pipeline is designed and how to add a new planning workflow. For the complete reference of all 9 chat stages and their substages, see [web-ui-state-machine.md](web-ui-state-machine.md).

## 1. Core Architecture Pattern

OpenVelo's planning modal operates as a **stateless-looking but database-driven state machine**. The state of any planning session is fully persisted in the SQLite database under the `chat_sessions` table via `stage`, `sub_stage`, `running`, `sub_stage_pre_error`, and `error_type`.

When a stage transitions (`transitionTo(chatId, newStage, newSubStage, options?)`):

1. The database row is updated.
2. `chat_updated` is broadcast on the project's WebSocket channel.
3. `sub_stage` is broadcast on the per-stage channel (`stage:<chatId>:<stage>`).
4. The server asynchronously re-invokes `runWorkflow(chatId)` for the new state, **unless** `newSubStage === 'error'` (terminal until manual retry).
5. On `error` transitions, the previous (pre-error) `sub_stage` is saved in `sub_stage_pre_error` so retry endpoints can resume.

```
                  ┌───────────────────────────────┐
                  │          Database             │
                  │ (stage, sub_stage, running,  │
                  │  sub_stage_pre_error,        │
                  │  error_type)                 │
                  └───────┬───────────────▲───────┘
                          │               │
            Read State    │               │ Update State / Trigger
   (Vite/React Page/WS)   │               │ (Express REST API / transitionTo)
                          ▼               │
                  ┌───────────────────────┴───────┐
                  │           Web UI              │
                  │ (React SPA / Express Backend) │
                  └───────────────┬───────────────┘
                          │       │     │
             Create/     │       │     │ Send Prompts
             Get Session │       │     │ & Get Response
                          ▼       ▼     ▼
                  ┌───────────────────────────────┐
                  │        Kilo Proxy             │
                  │       (kilo serve)            │
                  └───────────────────────────────┘
```

## 2. Component Directory Structure

- **Frontend SPA Components**: `components/web-ui/src/components/plan/`
  - Render stage-specific UI based on the active chat stage (`ChatCollecting.tsx`, `ChatDomain.tsx`, `ChatVerify.tsx`, …).
- **Backend API Routes**: `components/web-ui/src/api/routes/`
  - `chats.ts` — chat session CRUD, message persistence, transition triggers
  - `plan.ts` — plan epics/features/stories CRUD, plan retry/regenerate
  - `uploads.ts` — file upload (collecting-stage attach + verify-mode requirement upload)
- **Workflow State Machine**: `components/web-ui/src/lib/workflow/`
  - `index.ts` — central router (`getHandler`), state-transition engine (`transitionTo`, `runWorkflow`).
  - `stage-*.ts` — one handler per stage (see [web-ui-state-machine.md](web-ui-state-machine.md)).
- **LLM Session Registry**: `components/web-ui/src/lib/opencode-serve-registry.ts` (filename kept for legacy continuity; the binary it spawns is now `kilo`).
  - Caches and manages `kilo serve` instances and LLM sessions per chat session, ensuring conversation history is preserved across user turns. Each stage (`collecting`, `analyzing`, `plan`, `verify`, ...) gets its own dedicated session id.
- **Per-Stage WebSocket Manager**: `components/web-ui/src/lib/stage-ws-manager.ts`
  - Channels keyed by `stage:<chatId>:<stage>`. Used by stage handlers to push progress events without leaking across stages.

## 3. Detailed Lifecycle (using `collecting`)

The `collecting` stage's substages are: `''` (initial), `'new'` (just entered from `analyzing`), `'user'` (waiting on user), `'system'` (LLM processing), `'error'` (terminal until retry).

### Phase A: Setup and Transition to User State
1. `transitionTo(chatId, 'collecting', 'user')` fires.
2. The engine updates the DB row, broadcasts `chat_updated` to the project room, and broadcasts `{ type: 'sub_stage', sub_stage: 'user' }` to the stage channel.
3. `runWorkflow` runs but `getHandler('collecting', 'user')` returns `handleCollecting`, which has no branch for `'user'` and just returns.
4. The React frontend (`PlanPage.tsx`) receives the WS update, resolves the rendering component to `ChatCollecting` via `STAGE_COMPONENTS`, and unlocks the text input.

### Phase B: User Submits Input
1. The user types a message and clicks "Send".
2. The frontend POSTs to `/api/chatMessage` (persists user message) and `/api/collectNext`.
3. `/api/collectNext` calls `transitionTo(chatId, 'collecting', 'system')` → schedules `runWorkflow(chatId)`.

### Phase C: System Processes with LLM
1. `runWorkflow` returns immediately if `chat.running` is already true (single-runner guarantee), otherwise sets `running = true`, then runs `handleCollecting(chatId)` via `setImmediate()`.
2. `handleCollecting` → `handleSystem()`:
   - `serveRegistry.getOrCreate(chatId, chatDir, process.env)` to get the `kilo serve` client.
   - Fetches or creates a session id from `serveRegistry.getSession(chatId, 'collecting')`.
   - On a new session, reads `prompts/plan-collecting.md`, substitutes variables (`{REPO_CONTEXT}`, `{SKILLS_DIR}`, …), and uses it as the initial prompt. Otherwise sends the raw user message.
   - `client.sendMessage(sessionId, prompt, models.chat_model)`.
   - Parses the JSON response against:
     ```typescript
     interface LlmResponse {
       message: string;
       options: Array<{ recommended: boolean, option: string }>;
       ready_for_next_stage: boolean;
     }
     ```
     Falls back to a regex `\{[\s\S]*"message"[\s\S]*\}` if JSON parsing fails; on full failure, transitions to `error`.
   - Saves the system response (chat_messages + chat_message_options).
3. If `ready_for_next_stage` is `true`, transitions to the next stage (e.g. `transitionTo(chatId, 'domain', 'plan')`).
4. Otherwise loops back to `transitionTo(chatId, 'collecting', 'user')`.

### Phase D: Error and Recovery
On handler throw, the stage transitions to `error`. The `error` sub_stage is **terminal** — no auto re-invocation. The user must click "Retry" in the UI, which calls one of the retry endpoints:
- `POST /api/chats/:chatId/verify/retry`
- `POST /api/chats/:chatId/requirement/retry`
- `POST /api/chats/:chatId/final_assessment/retry`
- `POST /api/plan/:chatId/retry`

Each sets `running = false` then `transitionTo()` to the saved `sub_stage_pre_error`.

## 4. How to Implement a New Planning Stage/Workflow

### Step 1: Define Database States
No schema migration needed: `chat_sessions.stage` and `chat_sessions.sub_stage` are free-form TEXT. Just pick a stage name and list the expected substages in your handler.

### Step 2: Create the Stage Handler
Create `components/web-ui/src/lib/workflow/stage-my-custom-stage.ts`:
```typescript
import { getChatSession, getChatDir } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry'; // legacy filename; serves the kilo binary
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';

export async function handleMyCustomStage(chatId: number): Promise<void> {
  const chat = getChatSession(chatId);
  if (!chat) return;

  if (chat.sub_stage === '') {
    transitionTo(chatId, 'my_custom_stage', 'system');
    return;
  }

  if (chat.sub_stage === 'system') {
    stageWsManager.broadcastToStage(chatId, 'my_custom_stage', { type: 'sub_stage', sub_stage: 'system' });
    try {
      const client = serveRegistry.getOrCreate(chatId, getChatDir(chatId, chat.project_id), process.env);
      await client.ensureStarted();
      const sessionId = await client.createSession();
      await client.sendMessage(sessionId, 'Your custom prompt here', 'default_model');
      transitionTo(chatId, 'my_custom_stage', 'user');
    } catch (err) {
      // For error substages that support errorType, pass it so the frontend can show a useful message
      transitionTo(chatId, 'my_custom_stage', 'error', { errorType: 'llm_failure' });
    }
  }
}
```

### Step 3: Register in the Workflow Router
Open `components/web-ui/src/lib/workflow/index.ts`:
1. Import:
   ```typescript
   import { handleMyCustomStage } from './stage-my-custom-stage';
   ```
2. Map in `getHandler()`:
   ```typescript
   if (stage === 'my_custom_stage') return handleMyCustomStage;
   ```
3. Re-export at the bottom:
   ```typescript
   export { handleMyCustomStage } from './stage-my-custom-stage';
   ```

### Step 4: Expose API Triggers
Add a route in `components/web-ui/src/api/routes/chats.ts`:
```typescript
chatsRouter.post('/myCustomStageContinue', requireProjectAccess, (req, res) => {
  const { chatId } = req.body;
  transitionTo(Number(chatId), 'my_custom_stage', 'system');
  res.json({ success: true });
});
```

### Step 5: Implement the Frontend React Component
Create `components/web-ui/src/components/plan/ChatMyCustomStage.tsx`:
```tsx
import * as React from 'react';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import type { ChatSession } from '@/lib/types';

export function ChatMyCustomStage({ chat }: { chat: ChatSession }) {
  const { subStage } = useStageWebSocket(chat.id, chat.stage);
  return (
    <div className="p-4">
      <h3>My Custom Stage</h3>
      <p>Current state: {subStage}</p>
    </div>
  );
}
```

### Step 6: Map the Component
Open `components/web-ui/src/pages/PlanPage.tsx`:
```typescript
import { ChatMyCustomStage } from '@/components/plan/ChatMyCustomStage';
// ...
'my_custom_stage': ChatMyCustomStage,
```

### Optional: Add a Retry Endpoint
If your stage supports an `error` sub_stage, add a retry endpoint so the frontend can recover without re-creating the chat:
```typescript
chatsRouter.post('/:chatId/my_custom_stage/retry', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  const chat = getChatSession(chatId);
  if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }
  updateChatSession(chatId, { running: false });
  transitionTo(chatId, chat.stage, chat.sub_stage_pre_error);
  res.json({ success: true });
});
```
