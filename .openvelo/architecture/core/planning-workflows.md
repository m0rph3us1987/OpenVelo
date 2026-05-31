# Planning Workflows Architecture

This document describes how the conversational planning pipeline is designed, how states/stages/substages are coordinated between the database, Express API, and React frontend, and how to add a new planning workflow.

---

## 1. Core Architecture Pattern
OpenVelo's planning modal operates as a **stateless-looking but database-driven state machine**.
The state of any planning session is fully persisted in the SQLite database under the `chat_sessions` table via the `stage` and `sub_stage` fields.

When a stage transitions:
1. The database is updated.
2. Real-time updates are broadcast to the browser via WebSockets.
3. The server asynchronously executes the handler for the new state.

```
                  ┌───────────────────────────────┐
                  │          Database             │
                  │ (stage, sub_stage, running)  │
                  └───────┬───────────────▲───────┘
                          │               │
            Read State    │               │ Update State / Trigger
   (Vite/React Page/WS)   │               │ (Express REST API / transitionTo)
                          ▼               │
                  ┌───────────────────────┴───────┐
                  │           Web UI              │
                  │ (React SPA / Express Backend) │
                  └───────────────┬───────────────┘
                          │               │
             Create /     │               │ Send Prompts
             Get Session  │               │ & Get Response
                          ▼               ▼
                  ┌───────────────────────────────┐
                  │       OpenCode Proxy          │
                  │      (opencode serve)         │
                  └───────────────────────────────┘
```

---

## 2. Component Directory Structure
- **Frontend SPA Components**: `components/web-ui/src/components/plan/`
  - Render stage-specific UI based on the active chat stage (e.g. `ChatCollecting.tsx`, `ChatDomain.tsx`).
- **Backend API Routes**: `components/web-ui/src/api/routes/chats.ts`
  - Exposes REST endpoints to create sessions, send messages, and trigger workflow transitions.
- **Workflow State Machine**: `components/web-ui/src/lib/workflow/`
  - `index.ts`: The central router and state transition engine.
  - `stage-*.ts`: Handlers for each workflow stage (e.g. `stage-init.ts`, `stage-collecting.ts`).
- **LLM Session Registry**: `components/web-ui/src/lib/opencode-serve-registry.ts`
  - Caches and manages OpenCode server instances and LLM sessions per chat session, ensuring conversation history is preserved across user turns.

---

## 3. Detailed Lifecycle of a Workflow Stage

Using the `collecting` stage as an example, here is the exact execution loop:

### Phase A: Setup and Transition to User State
1. A transition triggers `transitionTo(chatId, 'collecting', 'user')`.
2. The transition engine:
   - Updates `chat_sessions`: `stage = 'collecting'`, `sub_stage = 'user'`, `running = false`.
   - Broadcasts `chat_updated` message to the project room using `wsManager.broadcastToProject`.
   - Broadcasts the new `sub_stage` via `stageWsManager.broadcastToStage`.
3. Because `sub_stage === 'user'`, the workflow engine halts re-invocation. It enters an idle state, waiting for user input.
4. The React frontend (`PlanPage.tsx`) receives the WS update, resolves the rendering component to `ChatCollecting` via `STAGE_COMPONENTS`, and unlocks the text input because `sub_stage === 'user'`.

### Phase B: User Submits Input
1. The user types a message in the UI and clicks "Send".
2. The React frontend:
   - Makes a POST request to `/api/chatMessage` to save the user's message in SQLite.
   - Makes a POST request to `/api/collectNext`.
3. The `/api/collectNext` route handler:
   - Triggers `transitionTo(chatId, 'collecting', 'system')`.
   - This marks `running = false` in the DB but immediately schedules `runWorkflow(chatId)` because the new substage is not `error`.

### Phase C: System Processes with LLM
1. `runWorkflow` starts:
   - Sets `running = true` in SQLite to prevent concurrent runs.
   - Calls `getHandler('collecting', 'system')` which returns `handleCollecting`.
   - Runs `handleCollecting(chatId)` asynchronously.
2. `handleCollecting` calls `handleSystem()`:
   - Gets or starts the `opencode serve` server instance via the `serveRegistry`.
   - Fetches or creates an LLM session `sessionId` from `serveRegistry`.
   - If this is a new session, it reads `prompts/plan-collecting.md`, substitutes variables (`{REPO_CONTEXT}`, `{SKILLS_DIR}`), and sets the initial prompt. If it's a subsequent turn, it simply sends the raw user message.
   - Calls `client.sendMessage(sessionId, prompt, chatModel)`.
   - Parses the LLM's JSON response, which must follow the `LlmResponse` schema:
     ```typescript
     interface LlmResponse {
       message: string;
       options: Array<{ recommended: boolean, option: string }>;
       ready_for_next_stage: boolean;
     }
     ```
   - Saves the system's response to the database (messages and options).
3. If `ready_for_next_stage` is `true`, it transitions to the next stage (e.g., `transitionTo(chatId, 'domain', 'plan')`).
4. Otherwise, it loops back to `transitionTo(chatId, 'collecting', 'user')`, reverting the UI to user-input mode.

---

## 4. How to Implement a New Planning Stage/Workflow

Follow these exact steps to add a new planning workflow or stage:

### Step 1: Define Database States
Define your new `stage` name and its expected `sub_stage` strings (e.g., `my_custom_stage` with substages `''`, `'user'`, `'system'`, `'error'`).

### Step 2: Create the Stage Handler
Create `components/web-ui/src/lib/workflow/stage-my-custom-stage.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import { getChatSession, getChatDir } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';

export async function handleMyCustomStage(chatId: number): Promise<void> {
  const chat = getChatSession(chatId);
  if (!chat) return;

  if (chat.sub_stage === '') {
    // Initial setup for the stage
    transitionTo(chatId, 'my_custom_stage', 'system');
    return;
  }

  if (chat.sub_stage === 'system') {
    // Notify frontend that system is thinking
    stageWsManager.broadcastToStage(chatId, 'my_custom_stage', { type: 'sub_stage', sub_stage: 'system' });
    
    try {
      const client = serveRegistry.getOrCreate(chatId, getChatDir(chatId, chat.project_id), process.env);
      await client.ensureStarted();
      
      const sessionId = await client.createSession();
      // Execute your custom prompt
      const result = await client.sendMessage(sessionId, "Your custom prompt here", "default_model");
      
      // Perform logic and transitions
      transitionTo(chatId, 'my_custom_stage', 'user');
    } catch (err) {
      transitionTo(chatId, 'my_custom_stage', 'error');
    }
  }
}
```

### Step 3: Register in the Workflow Router
Open `components/web-ui/src/lib/workflow/index.ts`:
1. Import your new handler:
   ```typescript
   import { handleMyCustomStage } from './stage-my-custom-stage';
   ```
2. Map your stages and substages to the handler inside `getHandler()`:
   ```typescript
   if (stage === 'my_custom_stage') return handleMyCustomStage;
   ```
3. Export it at the bottom:
   ```typescript
   export { handleMyCustomStage } from './stage-my-custom-stage';
   ```

### Step 4: Expose API Triggers (If User-Driven)
If your stage requires a user action to continue, add a route inside `components/web-ui/src/api/routes/chats.ts`:
```typescript
chatsRouter.post('/myCustomStageContinue', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body;
  transitionTo(Number(chatId), 'my_custom_stage', 'system');
  res.json({ success: true });
});
```

### Step 5: Implement the Frontend React Component
Create `components/web-ui/src/components/plan/ChatMyCustomStage.tsx` to handle the rendering of this stage. It should subscribe to WebSocket events via `useStageWebSocket` to update its state as the backend processes:
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

### Step 6: Map the Component in Vite Router
Open `components/web-ui/src/pages/PlanPage.tsx`:
1. Import your component:
   ```typescript
   import { ChatMyCustomStage } from '@/components/plan/ChatMyCustomStage';
   ```
2. Register it under `STAGE_COMPONENTS`:
   ```typescript
   'my_custom_stage': ChatMyCustomStage,
   ```
