# Plan Workflow Architecture Skill

## Overview

This skill provides a **template pattern** for implementing new stages in the plan workflow system. When adding a new stage (e.g., `myStage`), you need to create components in both frontend and backend, then wire them together following this established pattern.

---

## Architecture Pattern

The system uses a **two WebSocket architecture**:

| WebSocket | Purpose | Hook | Path Pattern |
|-----------|---------|------|--------------|
| `wsManager` (project-level) | Overall stage/status changes for chat list | `useChatListWebSocket` | `/ws?projectId={id}` |
| `stageWsManager` (stage-level) | Fine-grained progress within a stage | `useStageWebSocket` | `/ws/stage/{stage}?chatId={id}` |

---

## Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  NewChatButton │ PlanHeader (ChatName - stage) [●]     │
├────────────────┼────────────────────────────────────────┤
│                │                                        │
│   ChatList     │   Stage Component                      │
│   (sidebar)    │   (renders based on stage; may include   │
│                │    terminal/log output area)            │
│                │                                        │
└────────────────┴────────────────────────────────────────┘
```

**Grid Layout**: Uses CSS Grid with `grid-template-columns: 300px 1fr` and `grid-template-rows: 56px 1fr`

---

## PlanPage State Management

### Header State Pattern (CRITICAL - AVOID THESE MISTAKES)

**WRONG - Will cause header flickering:**
```typescript
// Don't clear header on every selectedChat change
useEffect(() => {
  setHeaderInfo({ title: '', showSpinner: false });  // ← WRONG
}, [selectedChat]);
```

**CORRECT:**
```typescript
// Only clear header when selectedChat becomes null (user deselects)
useEffect(() => {
  if (selectedChat === null) {
    setHeaderInfo({ title: '', showSpinner: false });
  }
}, [selectedChat]);
```

### Why This Matters

When WebSocket sends `chat_updated` event for the selected chat:
1. **Old buggy behavior**: `onChatSelect(updatedChat)` called → `selectedChat` changes → header cleared → component hasn't updated yet → header stays empty
2. **Correct behavior**: `onChatDataUpdated(updatedChat)` called → `selectedChat` updates with new stage → PlanPage re-renders with correct component → header not cleared

---

## ChatList Callbacks - CRITICAL DISTINCTION

**ChatList has TWO callbacks for updates:**

```typescript
interface ChatListProps {
  projectId: number;
  onChatSelect?: (chat: ChatSession | null) => void;      // User clicked a different chat
  onChatDataUpdated?: (chat: ChatSession) => void;        // WebSocket updated selected chat's data
  // ...
}
```

| Callback | When Called | Purpose |
|----------|--------------|---------|
| `onChatSelect` | User explicitly clicks a chat | Change selected chat (may clear header) |
| `onChatDataUpdated` | WebSocket `chat_updated` for selected chat | Update selected chat's data without header clear |

**Usage in PlanPage:**
```typescript
<ChatList
  onChatSelect={setSelectedChat}        // User interaction - may clear header
  onChatDataUpdated={setSelectedChat}    // WebSocket update - does NOT clear header
/>
```

---

## Implementing a New Stage

To add a new stage called `myStage`, follow this checklist:

### 1. Frontend Component (UI)

Create: `components/web-ui/src/components/plan/ChatMyStage.tsx`

```typescript
import { Loader2 } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';

interface ChatMyStageProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

export function ChatMyStage({ chat, onHeaderInfo }: ChatMyStageProps) {
  const { subStage } = useStageWebSocket({ chatId: chat.id, stage: 'myStage' });

  // Report header info on mount AND when subStage changes
  // DO NOT add cleanup function that clears header on every re-run
  React.useEffect(() => {
    onHeaderInfo?.({
      title: `${chat.name} - myStage`,
      showSpinner: true,
    });
  }, [chat.id, subStage]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <span className="text-muted-foreground">
        {subStage === 'step1' ? 'Doing step 1...' : 'Doing step 2...'}
      </span>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
```

**Pattern**:
- Component receives optional `onHeaderInfo` callback prop
- On mount and when `subStage` changes, calls `onHeaderInfo` with title and showSpinner
- **DO NOT** use cleanup function in useEffect to clear header on every re-run
- Title format: `{chat.name} - {stage}`
- showSpinner: `true` if component displays progress, `false` if static/completed
- **IMPORTANT**: Include `subStage` in useEffect dependency array

### Stage Components with Log Output

Some stage components display live log output from the backend via a **TextLog** component:

```typescript
// Stage component with log display
export function ChatMyStage({ chat, onHeaderInfo }: ChatMyStageProps) {
  const { subStage } = useStageWebSocket({ chatId: chat.id, stage: 'myStage' });

  React.useEffect(() => {
    // Dynamic title based on sub-stage
    const titleMap: Record<string, string> = {
      'step1': 'Step 1 name',
      'step2': 'Step 2 name',
    };
    onHeaderInfo?.({
      title: `${chat.name} - ${titleMap[subStage] ?? 'Working'}`,
      showSpinner: true,
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  // Use TextLog for terminal-style output display
  return <TextLog chatId={chat.id} />;
}
```

**Pattern**:
- `TextLog` component connects to WebSocket and displays log messages
- Title should reflect current sub-stage for user feedback
- Backend should use `appendVerbose()` to broadcast log messages

### Backend Logging

Stage handlers should use the logger service to broadcast progress:

```typescript
// In stage handler - logs to console AND broadcasts to frontend
loggerService.appendVerbose(chatId, 'workflow:myStage', 'Doing work...');
```

This ensures logs appear in the server console and are displayed in the frontend TextLog component via WebSocket.

**Common Mistake to Avoid:**
```typescript
// WRONG - Will cause header to disappear on every subStage change
React.useEffect(() => {
  onHeaderInfo?.({
    title: `${chat.name} - ${subStage}`,  // dynamic based on subStage
    showSpinner: true
  });
  // ← WRONG: do NOT add cleanup that clears header
}, [chat.id, subStage]);
```

### 2. Register in PlanPage

Edit: `components/web-ui/src/pages/PlanPage.tsx`

```typescript
const STAGE_COMPONENTS: Record<string, React.ComponentType<{ chat: ChatSession; onHeaderInfo?: (info: HeaderInfo) => void }>> = {
  'init': ChatInit,
  'analyzing': ChatAnalysis,
  'myStage': ChatMyStage,  // ADD THIS LINE
};
```

**Pattern**: Add entry to `STAGE_COMPONENTS` map with key = stage name and value = component.

### 3. Backend Stage Handler

Create: `components/web-ui/src/lib/workflow/stage-myStage.ts`

```typescript
import { getChatSession } from '@/lib/db';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';

export async function handleMyStage(chatId: number): Promise<void> {
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:myStage] Chat ${chatId} not found`);
    return;
  }

  console.log(`[workflow:myStage] Starting for chat ${chatId}`);

  // Step 1: Transition to first sub-stage
  transitionTo(chatId, 'myStage', 'step1');
  stageWsManager.broadcastToStage(chatId, 'myStage', { type: 'sub_stage', sub_stage: 'step1' });

  // Step 2: Do work...

  // Step 3: Transition to next sub-stage or next stage
  transitionTo(chatId, 'nextStage', '');
  // OR for final stage:
  // transitionTo(chatId, 'complete', '');
}
```

**Pattern**: Handler receives `chatId`, performs work, calls `transitionTo()` to move to next stage/sub-stage.

### 4. Register Handler in Workflow Engine

Edit: `components/web-ui/src/lib/workflow/index.ts`

```typescript
function getHandler(stage: string, subStage: string): WorkflowHandler | null {
  if (stage === 'init' && subStage === '') return handleInit;
  if (stage === 'analyzing' && subStage === '') return handleAnalyzing;
  if (stage === 'myStage' && subStage === '') return handleMyStage;  // ADD THIS
  return null;
}

export { handleInit } from './stage-init';
export { handleAnalyzing } from './stage-analyzing';
export { handleMyStage } from './stage-myStage';  // ADD THIS
```

**Pattern**: Add condition in `getHandler()` and export the handler.

---

## Wiring Flow

### User Opens Chat:
```
User clicks chat → onChatSelect(chat) → selectedChat changes → header cleared
                         │
                         ▼
               Component mounts (e.g., ChatInit)
                         │
                         ▼
               onHeaderInfo({ title: "...", showSpinner: true })
                         │
                         ▼
               Header re-renders with title + spinner
```

**Important: chatOpen Delay**

When a user opens a chat, there is a deliberate delay before the workflow starts. This allows the frontend to:
1. Receive the HTTP response
2. Mount the stage component
3. Establish WebSocket connections

Without this delay, log messages may be broadcast before the frontend is ready to receive them, causing missed output in log display components.

### WebSocket Updates Chat Stage (e.g., init → analyzing):
```
Backend broadcasts { type: 'chat_updated', chatId, stage: 'analyzing' }
                         │
                         ▼
               useChatListWebSocket receives event
                         │
                         ▼
               ChatList: onChatDataUpdated(updatedChat)  ← Key: NOT onChatSelect
                         │
                         ▼
               PlanPage: selectedChat updates with new stage
                         │
                         ▼
               PlanPage re-renders with ChatAnalysis (based on stage)
                         │
                         ▼
               ChatAnalysis mounts and calls onHeaderInfo
```

**CRITICAL**: WebSocket updates should use `onChatDataUpdated` (not `onChatSelect`) to avoid header clearing issues.

---

## Transition Function Signature

```typescript
transitionTo(chatId: number, newStage: string, newSubStage: string): void
```

This function:
1. Updates `chat_sessions` table with new `stage` and `sub_stage`
2. Broadcasts `chat_updated` event via `wsManager` to update chat list (triggers `onChatDataUpdated`)
3. Broadcasts `sub_stage` event via `stageWsManager` to update stage UI
4. Triggers next workflow step by calling `runWorkflow(chatId)`

---

## Database Schema

```sql
CREATE TABLE chat_sessions (
  id INTEGER PRIMARY KEY,
  mode TEXT CHECK(mode IN ('plan', 'quick', 'verify')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'init',
  sub_stage TEXT NOT NULL DEFAULT '',
  created_at DATETIME,
  updated_at DATETIME
);
```

**Stage values**: Any string (e.g., 'init', 'analyzing', 'myStage')
**Sub-stage values**: Any string for granular progress (e.g., 'cloning', 'starting', 'step1')

---

## Key Files

| File | Purpose |
|------|---------|
| `pages/PlanPage.tsx` | Stage→Component routing, header state management |
| `components/plan/ChatList.tsx` | Chat list with `onChatSelect` and `onChatDataUpdated` callbacks |
| `components/plan/Chat*.tsx` | Stage UI components (call onHeaderInfo on mount/subStage change) |
| `lib/workflow/index.ts` | Handler registry & transition function |
| `lib/workflow/stage-*.ts` | Stage handler implementations |
| `lib/websocket-manager.ts` | Project-level wsManager |
| `lib/stage-ws-manager.ts` | Stage-level wsManager |
| `hooks/useStageWebSocket.ts` | Frontend stage WS hook |
| `hooks/useChatListWebSocket.ts` | Frontend project WS hook |
| `hooks/useChatWebSocket.ts` | Frontend hook for subscribing to chat log messages |
| `lib/logger-service.ts` | Logger with `appendVerbose()` for console + WS log output |
| `components/ui/text-log.tsx` | Reusable terminal-style textarea for log display |
| `lib/db.ts` | `transitionTo()` updates chat_sessions table |

---

## Checklist for New Stage

- [ ] Create `ChatMyStage.tsx` component in `components/plan/`
- [ ] Component must accept `onHeaderInfo?: (info: HeaderInfo) => void` prop
- [ ] Component must call `onHeaderInfo` on mount and when `subStage` changes
- [ ] **DO NOT** add cleanup function that clears header on every re-run
- [ ] Add to `STAGE_COMPONENTS` in `PlanPage.tsx`
- [ ] Create `stage-myStage.ts` handler in `lib/workflow/`
- [ ] Register handler in `getHandler()` in `lib/workflow/index.ts`
- [ ] Export handler from `lib/workflow/index.ts`
- [ ] Call `transitionTo(chatId, 'myStage', '')` to enter the stage
- [ ] Call `transitionTo(chatId, 'myStage', 'substep')` for sub-stage updates
- [ ] Call `transitionTo(chatId, 'nextStage', '')` to transition to next stage
- [ ] Backend handler uses `loggerService.appendVerbose()` for log output
- [ ] If component displays logs, use TextLog and update header title dynamically based on subStage