# `requirement` Chat Mode

A fourth `chat_sessions.mode` value that produces a plan from a user-supplied requirement document, bypassing the `collecting` Q&A stage.

## Lifecycle

```
createChatSession(mode='requirement')
   │
   ▼  init → analyzing (analyzer_model produces REPOSITORY.md)
   │
   ▼  stage-analyzing.ts: chat.mode === 'verify' || chat.mode === 'requirement'
   ▼                       → transitionTo('verify', 'upload')
   │
   ▼  ChatRequirementUpload (mounted by PlanPage.STAGE_DISPATCH for mode='requirement', stage='verify', sub_stage='upload')
   ▼  User selects a .md/.txt file → POST /api/chats/:chatId/upload-requirement
   │
   ▼  routes/chats.ts branches on chat.mode:
   ▼    verify      → writes ORIGINAL_REQUIREMENT.md → transitionTo('verify', 'analysis')
   ▼    requirement → writes REQUIREMENT.md         → transitionTo('requirement', 'requirement')  (terminal substage)
```

The `requirement` mode reuses the `verify/upload` UI substage but never enters `verify/analysis`; it lands directly at the existing `requirement/requirement` terminal substage where `REQUIREMENT.md` is treated as the source of truth for downstream `plan` generation.

## Component Wiring

| Layer | File | Responsibility |
|-------|------|----------------|
| Type union | `components/web-ui/src/lib/types.ts` (`ChatMode`) | Adds `'requirement'`. |
| DB constraint | `components/web-ui/src/lib/db.ts` (`chat_sessions` `CHECK(mode IN ...)`) | Includes `'requirement'`; idempotent in-place migration renames the legacy table, recreates with the widened CHECK, copies data, and bumps `ui_settings.db_version`. |
| Validation | `components/web-ui/src/api/router.ts` + `routes/chats.ts` (`POST /api/chatCreate`) | Accepts `'requirement'` alongside the three existing modes. |
| Stage transition | `components/web-ui/src/lib/workflow/stage-analyzing.ts` | Treats `requirement` like `verify` on the `analyzing → verify/upload` branch. |
| Upload route | `components/web-ui/src/api/routes/chats.ts` (`POST /api/chats/:chatId/upload-requirement`) | Mode-aware destination path and target substage; rejects empty files, non-`.md`/`.txt`, and chats not in `verify/upload`. |
| UI dispatch | `components/web-ui/src/pages/PlanPage.tsx` (`STAGE_DISPATCH`) | Mode-aware component selection: `requirement` + `verify/upload` → `ChatRequirementUpload`; bare `verify/upload` → `ChatVerify`. |
| Upload UI | `components/web-ui/src/components/plan/ChatRequirementUpload.tsx` | New component; subscribes to `useStageWebSocket({ stage: 'verify' })`, posts `multipart/form-data` to `/api/chats/:chatId/upload-requirement`, surfaces 400/403/404/409/413 error messages. |
| Step indicator | `components/web-ui/src/components/plan/PlanHeader.tsx` (`REQUIREMENT_STEPS`) | Adds a 4-step progress bar (`Analysis → Upload → Requirement → Plan`). |
| Modal entry | `components/web-ui/src/components/plan/NewChatModal.tsx` (`MODE_OPTIONS`) | Adds a "Requirement" tile (FileText icon) to the mode selector grid. |

## Error Surface

`POST /api/chats/:chatId/upload-requirement` rejects with structured JSON `error` strings:

| Condition | HTTP | `error` |
|-----------|------|---------|
| Missing/mismatched file field | 400 | `No file uploaded` |
| Wrong extension | 400 | `Only .md and .txt files are accepted` |
| Empty file | 400 | `Empty file` |
| Wrong substage | 400 | `Chat is not in the upload substage` |
| Mode not supported | 409 | `Upload is only supported in verify or requirement mode` |
| Chat not found | 404 | `Chat session not found` |
| Directory missing | 404 | `Chat directory not found` |

## Migration Notes

- Pre-existing rows are preserved verbatim (the legacy table is renamed to `chat_sessions__legacy`, recreated with the widened CHECK, and copied back).
- The migration is guarded by `SELECT sql FROM sqlite_master` and runs only when the current `chat_sessions` definition does not yet mention `'requirement'`.
- `ui_settings.db_version` is bumped to `'2'` on successful migration.