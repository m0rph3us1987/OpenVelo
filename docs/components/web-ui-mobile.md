# Web UI — Mobile Layer

The mobile layer is a parallel set of view components served to mobile/tablet clients. It is detected and wired into the existing React Router tree inside `SecurityRouter`; there is no separate Express route, build target, or API surface — the mobile views consume the same backend (`/api/*` + WebSocket channels) as the desktop SPA.

## 1. Detection — `useIsMobile`

`components/web-ui/src/hooks/useIsMobile.ts:5-16` (the `detect()` function) returns `true` if **any** of the following hold:

1. `navigator.userAgent` matches the bundled `MOBILE_UA_REGEX` (`useIsMobile.ts:3` — Android, iPhone/iPad/iPod, webOS, BlackBerry, IEMobile, Opera Mobi, generic `Mobile`/`Tablet`).
2. `window.matchMedia('(max-width: 768px)').matches`.
3. `window.innerWidth < 768`.

The hook (`useIsMobile.ts:21-45`) keeps the boolean in `useState`, then in `useEffect` subscribes to three sources for live updates and runs the detector again on each:

- `matchMedia('(max-width: 768px)').change`
- `window.resize`
- `window.orientationchange`

SSR-safe: `detect()` returns `false` when `window` is undefined. Initial render uses the synchronous detect so there is no mobile→desktop flash on a freshly mounted client.

## 2. Mobile Shell Architecture

All mobile views render inside `MobileShell`, which provides a consistent chrome (top bar + slide-in drawer + scrim). Views own the `drawerOpen` state and pass it to the shell via `open` / `onOpenChange`. When a view needs in-app navigation (e.g. the new admin / settings / project-create screens) it passes an optional `onBack` callback, which causes `MobileTopBar` to render a back chevron instead of the hamburger menu.

`MobileShell` (`MobileShell.tsx`) layers these responsibilities:

- **`MobileTopBar`** — sticky header, 56 px min-height. Two lead-button modes:
  - **Hamburger** (default): opens the drawer.
  - **Back chevron** (when `onBack` is supplied): runs the callback (defaults to `navigate(-1)`).
  - Centered `title` plus optional `rightSlot` (the desktop `MobileProjectLayout` passes a live orchestrator status pill here).
- **`MobileDrawer`** — left-side navigation drawer (`w-[85vw] max-w-[360px]`) with these stacked sections (top → bottom):
  - `MobileProjectsList` — fetches `/api/projects`, lists every project (active one highlighted), and renders an admin-only **"New project"** row that navigates to `/projects/new`.
  - `MobileProjectNav` — Jobs / Plan / Settings rows; only rendered when a `projectId` is provided. Jobs and Plan navigate via `react-router`; Settings now navigates to `/settings` (previously it opened a local `EditProjectDialog` sheet — see §4).
  - `MobileGlobalNav` — **always rendered**, lists `Settings` and `Themes` for every user; admins additionally see `Models`, `Users`, `Groups`. Each row navigates to its dedicated route and closes the drawer.
  - `MobileAuthMenu` — user / logout row.
- **Scrim** — a full-screen `<button>` (`inset-0 z-40 bg-black/50`) behind the drawer that closes it on click.
- **Lifecycle side-effects** — three internal hooks handle the drawer UX:
  - `useBodyScrollLock` — sets `body.style.overflow = 'hidden'` while open and restores on close.
  - `useEscapeClose` — `Escape` key closes the drawer.
  - `usePopstateClose` — pushes a synthetic `history` entry when the drawer opens so the device back button closes it (and pops back on unmount).
- **Animation phases** — both scrim and drawer run a 4-phase machine (`closed → opening → open → closing`) timed by 300 ms `setTimeout`s (`MobileDrawer.tsx:54-64`), gated by `prefers-reduced-motion` (animations collapse to 1 ms via `globals.css`).

Touch swipe-to-close: `MobileDrawer` (`MobileDrawer.tsx:120-140`) tracks `touchstart`/`touchmove`/`touchend`; a `deltaX < -50` (left swipe past 50 px) closes the drawer.

Navigation plumbing: `MobileDrawer` accepts an optional `onNavigate(path)` callback (set by `MobileShell` to `react-router`'s `navigate`); if a view passes its own callback it wins. Every nav row (project list "New project", `MobileProjectNav` rows, `MobileGlobalNav` rows) calls `onNavigate` and then `onClose()`.

## 3. Mobile Project Page — Jobs UI

`MobileProjectPage` (`MobileProjectPage.tsx`) is the mobile `/projects/:id` index view. It pulls `project`, `projectId`, `liveStatus` from `MobileProjectLayout`'s `OutletContext` and owns the per-page interaction state (selected job, add-job dialog, scroll position). Its layout is a vertical stack:

```
MobileProjectPage
 ├─ MobileStatusHeader     (live dot, maxParallel editor, play/stop/+ Job)
 ├─ <div ref scroll>       (flex-1, overflow-y-auto, safe-area padding)
 │   └─ MobileJobList      (rows of StateBadge + DependencyBadge; tap → openJob)
 └─ AddJobDialog           (controlled; onCreated → refetch())
```

When a job is selected the page swaps to a full-surface `MobileJobDetailStack` — there is no nested router; `selectedJobId` is plain React state. On close the previously saved `scrollTop` is restored via `requestAnimationFrame`, and an `Escape` key listener closes the selection (mounted only while `selectedJobId !== null`, `MobileProjectPage.tsx:60-73`).

Data wiring:
- `useWebSocket({ projectId, enabled: true })` — same WS stream the desktop uses; messages are filtered to `WsJobUpdateMessage` (`type === 'job_update'`) and passed into `useWorkItems({ projectId, jobUpdates })` (see [web-ui-subsystems.md](web-ui-subsystems.md)) so the list updates live without re-fetching.
- `useWorkItems` returns `{ jobs, refetch, isLoading }`; the `onCreated` of `AddJobDialog` calls `refetch()` to pull the newly-inserted row.
- `hasRunningJobs` is derived locally (`jobs.some(j => j.status === 'RUNNING')`) and passed into `MobileStatusHeader`, where it switches the live dot color and label between `Running` / `Pending` / `Stopped` (`MobileStatusHeader.tsx:32-40`).

`MobileJobDetailStack` does **not** re-implement the cockpit — it renders the shared `<JobDetailContent variant="stacked" />` from `components/web-ui/src/components/dashboard/JobDetailModal.tsx` (which was refactored so the body is reusable in both the desktop modal and the mobile stacked view). The `stacked` variant swaps typography to `text-mobile-*`, applies `tap-target` to header buttons, and removes the desktop-only action row.

## 4. Mobile Project Layout

`MobileProjectLayout` (`MobileProjectLayout.tsx`) is the dedicated mobile wrapper for `/projects/:id` — it replaces the desktop `ProjectLayout` on mobile clients via the inline `isMobile ? <MobileProjectLayout /> : <ProjectLayout />` ternary on the `/projects/:id` route (`App.tsx:87-89`). It:

1. Parses `id` from `useParams`; calls `/api/projects/${projectId}` to fetch the project.
2. Subscribes to live status via the shared `useProjectStatus(projectId)` hook (same hook used by the desktop layout — see [web-ui-subsystems.md](web-ui-subsystems.md)).
3. Passes a `<MobileShell>` containing:
   - `title={project.name}`
   - `activeProjectId` / `projectId` for `MobileProjectsList` highlighting
   - `onSelectProject` that navigates to `/projects/${pid}` and closes the drawer
   - `rightSlot` is a **live orchestrator status pill** (`running` / `stopped`) driven by `liveStatus` from `useProjectStatus`.
   - No `onBack` callback — the project layout is a top-level destination, so the top bar shows the hamburger rather than a back chevron.
4. Wraps content in `<PasswordGate>` if `project.password_hash` is set (same gate as desktop, see [core/auth.md](../core/auth.md)).
5. Renders `<Outlet>` so child routes (`MobileProjectPage` at index, `MobilePlanPage` at `/plan`) mount inside the shell, and passes an `OutletContext` of `{ project, projectId, liveStatus }` — child pages consume this via `useOutletContext` (see §7).

Project editing has moved out of the drawer and into a dedicated full-screen route: `/projects/:id/edit` → `MobileProjectEdit` (§6.1). The Settings row in `MobileProjectNav` now navigates to `/settings` (a single global settings page) instead of opening a project-specific dialog.

## 5. Key Files

| File | Purpose |
|------|---------|
| `components/web-ui/src/hooks/useIsMobile.ts` | UA + viewport detector; live-updated via matchMedia / resize / orientationchange. |
| `components/web-ui/src/components/mobile/MobileShell.tsx` | Shell wrapper: top bar (hamburger **or** back chevron) + drawer + scrim + body-scroll/Escape/popstate side-effects. |
| `components/web-ui/src/components/mobile/MobileTopBar.tsx` | Sticky header; renders hamburger or back chevron in the lead slot, plus title and optional `rightSlot`. |
| `components/web-ui/src/components/mobile/MobileDrawer.tsx` | Left slide-in nav drawer; contains `MobileProjectsList` (with admin "New project" row), `MobileProjectNav` (project-scoped), `MobileGlobalNav` (always-on Settings/Themes + admin Models/Users/Groups), and `MobileAuthMenu`. Accepts an optional `onNavigate` callback so views can intercept navigation. Touch swipe-to-close. |
| `components/web-ui/src/components/mobile/MobileProjectsList.tsx` | `GET /api/projects`; renders project rows with active highlighting plus an admin-only "New project" row. |
| `components/web-ui/src/components/mobile/MobileProjectNav.tsx` | Jobs / Plan / Settings nav rows inside the drawer (only when `projectId` is set). Settings now navigates to `/settings` via `onNavigate` (previously it opened a local dialog). |
| `components/web-ui/src/components/mobile/MobileGlobalNav.tsx` | Always-rendered drawer section listing Settings + Themes for all users; admins additionally see Models, Users, Groups. Each row uses the supplied `onNavigate` callback and closes the drawer. |
| `components/web-ui/src/components/mobile/MobileProjectLayout.tsx` | `/projects/:id` layout: fetches project, mounts `MobileStatusHeader`-adjacent shell, wraps content in `PasswordGate`, provides `OutletContext` (`{ project, projectId, liveStatus }`) to children. `rightSlot` is a live orchestrator status pill (`running`/`stopped`). The settings cog is gone — project editing lives at `/projects/:id/edit`. |
| `components/web-ui/src/components/mobile/MobileHome.tsx` | `/` view — wraps content in `MobileShell` (no project context, so the drawer shows the projects list and global nav). |
| `components/web-ui/src/components/mobile/MobileLogin.tsx` | `/login` view: full login form posting to `/api/auth/login`; honors `?from=` redirect and `resetRequired` (navigates to `/change-password?redirect=…`). |
| `components/web-ui/src/components/mobile/MobileChangePassword.tsx` | `/change-password` view: full password-change form posting to `/api/auth/change-password`; honors `?redirect=`. |
| `components/web-ui/src/components/mobile/MobileSettings.tsx` | `/settings` view: app title, theme preference, models (reuses `ModelsTab`), users (reuses `UsersTab`), groups (reuses `GroupsTab`). Uses `MobileTabBar` for section navigation. |
| `components/web-ui/src/components/mobile/MobileThemes.tsx` | `/themes` view: theme picker — lists every theme from `useThemeContext()` and calls `setTheme`. |
| `components/web-ui/src/components/mobile/MobileModelsAdmin.tsx` | `/models` view: thin shell that mounts the shared `ModelsTab` inside a `MobileShell` (back chevron, mobile body padding). |
| `components/web-ui/src/components/mobile/MobileUsersAdmin.tsx` | `/users` view: thin shell that mounts the shared `UsersTab` inside a `MobileShell`. |
| `components/web-ui/src/components/mobile/MobileGroupsAdmin.tsx` | `/groups` view: thin shell that mounts the shared `GroupsTab` inside a `MobileShell`. |
| `components/web-ui/src/components/mobile/MobileProjectCreate.tsx` | `/projects/new` view (admin only): full create flow reusing `ProjectForm`; sectioned with `MobileAccordion`, validated step-by-step via `runCreateValidation` + `INITIAL_VALIDATION_STEPS` from `lib/project-validation`; per-section banners via `MobileFieldValidationBanners`; summary via `MobileValidationSummary`; posts to `/api/projects`. |
| `components/web-ui/src/components/mobile/MobileProjectEdit.tsx` | `/projects/:id/edit` view (admin only): same create flow but preloaded from `GET /api/projects/:id` and posted to `/api/projects/:id` (PUT); validates via `runUpdateValidation` + `EDIT_VALIDATION_STEPS`. |
| `components/web-ui/src/components/mobile/MobileTabBar.tsx` | Sticky horizontal section tab bar (used by `MobileSettings` to switch between General / Models / Users / Groups). |
| `components/web-ui/src/components/mobile/MobileAccordion.tsx` | Radix-Collapsible wrapper used by the create/edit forms to break the form into collapsible sections (General / Repo / Build & Exec / Models). |
| `components/web-ui/src/components/mobile/MobileFieldValidationBanners.tsx` | Per-field validation status banners (idle / running / success / error) for the create/edit forms. |
| `components/web-ui/src/components/mobile/MobileValidationSummary.tsx` | Aggregated list of `ValidationStep` statuses for the create/edit forms. |
| `components/web-ui/src/lib/project-validation.ts` | Shared validation step machine: defines `INITIAL_VALIDATION_STEPS` and `EDIT_VALIDATION_STEPS`, plus `runCreateValidation` / `runUpdateValidation` helpers that resolve each step (form-field check, repo fetch, model fetch, etc.) and return an updated `ValidationStep[]`. |
| `components/web-ui/src/components/mobile/MobileProjectPage.tsx` | `/projects/:id` index view: composes `MobileStatusHeader` + `MobileJobList`, manages selected-job state with scroll-position save/restore and `Escape`-to-close, swaps to `MobileJobDetailStack` when a job is selected, opens `AddJobDialog` for new jobs. |
| `components/web-ui/src/components/mobile/MobilePlanPage.tsx` | `/projects/:id/plan` view: a 2-pane horizontal slider (list ↔ panel) driven by `useViewStack`; consumes `OutletContext` for `projectId`, owns `chats`/`listLoaded` state, opens `MobileNewChatSheet`, swaps in `MobileChatPanelView` with scroll-position memory per chat. |
| `components/web-ui/src/components/mobile/plan/MobileChatListView.tsx` | Chat list pane — `GET /api/chats?projectId=`, `POST /api/chatDelete`, mounts `MobileNewChatSheet`; subscribes to chat-list WS via `useChatListWebSocket` for live create/update/delete. |
| `components/web-ui/src/components/mobile/plan/MobileChatPanelView.tsx` | Chat panel pane — dispatches on `chat.stage` / `chat.sub_stage` / `chat.mode` to one of the shared `Chat*` components (`ChatCollecting`, `ChatDomain`, `ChatPlan`, `ChatVerify`, `ChatInit`, `ChatAnalysis`, `ChatFinalAssessment`, `ChatRequirement`, `ChatRequirementUpload`); installs `useSwipeBack`; restores per-chat scroll position from the ref. |
| `components/web-ui/src/components/mobile/plan/MobileChatPanelHeader.tsx` | Sticky panel header showing chat name, mode chip, live spinner, and a back button — driven by `onHeaderInfo` callbacks from the stage component. |
| `components/web-ui/src/components/mobile/plan/MobileNewChatSheet.tsx` | Bottom-sheet dialog for creating a new chat (`POST /api/chatStart`) — opens via the list pane's "+" button. |
| `components/web-ui/src/components/mobile/plan/useViewStack.ts` | URL-driven nav stack: derives `view: 'list' \| 'panel'` and `activeChatId` from the `?chat=<id>` search param; exposes `push` (new history entry), `select` (replace), and `back` (pop). |
| `components/web-ui/src/components/mobile/plan/useSwipeBack.ts` | Edge-swipe gesture hook — listens for `touchstart` from the left 24 px edge; fires `onBack` when horizontal delta ≥ 50 px and vertical drift ≤ 40 px. |
| `components/web-ui/src/components/mobile/jobs/MobileStatusHeader.tsx` | Collapsible header above the job list — shows live orchestrator dot, status label, `maxParallel` editor, play/stop/queue actions, and an "Add Job" button. |
| `components/web-ui/src/components/mobile/jobs/MobileJobList.tsx` | Vertical scrollable list of jobs with `StateBadge` + `DependencyBadge`, loading/empty states, "Add Job" CTA in the empty state. |
| `components/web-ui/src/components/mobile/jobs/MobileJobDetailStack.tsx` | Full-screen mobile wrapper around `JobDetailContent` (`variant="stacked"`) so the cockpit renders inline between status header and shell bottom rather than as a desktop-style modal. |
| `components/web-ui/src/components/dashboard/JobDetailModal.tsx` | Exposes `JobDetailContent` (split out from `JobDetailModal`) which now accepts `variant: 'modal' \| 'stacked'` — `'stacked'` is consumed by `MobileJobDetailStack` and uses mobile typography/tap targets. The original `JobDetailModal` still wraps it in the desktop cockpit shell. |
| `components/web-ui/src/components/projects/ProjectForm.tsx` | The shared create/edit form (reused by desktop `EditProjectDialog` and mobile `MobileProjectCreate` / `MobileProjectEdit`). |
| `components/web-ui/src/components/models/ModelsTab.tsx` | The shared models registry admin panel; mounted inside `MobileSettings` (under the "Models" tab) and inside `MobileModelsAdmin`. |
| `components/web-ui/src/components/ui/mobile-sheet.tsx` | Mobile bottom/full sheet primitive (Radix Dialog with viewport-aware `phone`/`tablet` sizing and a `variant: 'bottom' \| 'full'` prop). Foundation for every mobile modal/sheet in the layer. |
| `components/web-ui/src/components/ui/mobile-confirm-dialog.tsx` | `MobileConfirmDialog` — `MobileSheet`-backed confirm dialog with `variant: 'destructive' \| 'default'`, busy state, and an async-aware confirm button. Replaces ad-hoc `Dialog`/`DialogContent` blocks in mobile views. |
| `components/web-ui/src/components/mobile/MobileAddJobSheet.tsx` | Mobile create/edit job sheet. Replaces the desktop `AddJobDialog` for the `/projects/:id` index; calls `POST /api/projects/:id/jobs` (create) or `PUT /api/projects/:id/jobs/:jobId` (edit) and pre-fills from `editJob`. Wired into `MobileProjectPage` instead of `AddJobDialog`. Includes a `MobileConfirmDialog` to guard against losing unsaved edits. |
| `components/web-ui/src/components/mobile/jobs/MobileJobInfoSheet.tsx` | Mobile read-only job-description sheet — replaces the desktop `JobInfoModal` when `useIsMobile()` is true; lazy-imported by `JobDetailContent` (see [web-ui.md](web-ui.md)). Sanitises `job.description` with `DOMPurify` and renders it inside a `MobileSheet` (`variant="full"`). |
| `components/web-ui/src/components/mobile/MobileSseSheet.tsx` | Mobile debug viewer for the raw `/ws?chatId=<n>` SSE feed. Opened from the `/settings` → "Open SSE feed" form; opens a `WebSocket`, appends every `rawSse` frame to a read-only textarea, and cleans up on close. |
| `components/web-ui/src/components/mobile/MobileUsersBody.tsx` | Mobile-native Users admin body (`MobileUsersTab`) — replaces the shared `UsersTab` in the `/users` route. Self-contained CRUD for `/api/users` and `/api/users/:id/password` (reset) using `MobileSheet` for create/edit forms and a built-in `MobileConfirmDialog` for delete. |
| `components/web-ui/src/components/mobile/MobileGroupsBody.tsx` | Mobile-native Groups admin body (`MobileGroupsTab`) — replaces the shared `GroupsTab` in the `/groups` route. Self-contained CRUD for `/api/groups` and `/api/projects` (member/project pickers); uses `MobileSheet` and `MobileConfirmDialog` like `MobileUsersBody`. |
| `components/web-ui/src/hooks/useChatListWebSocket.ts` | Per-project chat-list WebSocket (`/ws?projectId=…`) — auto-reconnecting; emits `chat_updated` / `chat_created` / `chat_deleted` events. Used by both `MobilePlanPage` and `MobileChatListView`. |
| `components/web-ui/src/App.tsx:12-62` | Lazy `React.lazy` imports of every mobile view (code-split chunks), including the new admin/settings/edit views. |
| `components/web-ui/src/App.tsx:79-152` | Single `<Routes>` block inside `SecurityRouter` — each `<Route>` selects its element via `isMobile ? <Mobile…/> : <Desktop…/>` (or `Navigate to="/"` on desktop for the mobile-only admin/settings routes), so the desktop components are never rendered on a mobile client and vice versa. |
| `components/web-ui/src/App.tsx:81-152` | Per-route mobile/desktop ternaries: `/`, `/login`, `/change-password`, `/projects/:id` (layout + `index` + `plan` child), and the mobile-only admin/settings/edit routes (`/settings`, `/themes`, `/models`, `/users`, `/groups`, `/projects/new`, `/projects/:id/edit`). |
| `components/web-ui/index.html` | Mobile viewport meta (`viewport-fit=cover, maximum-scale=5.0`). |
| `components/web-ui/src/globals.css` | Registers `tailwind-mobile-plugin`; applies `env(safe-area-inset-*)` padding to `body`; defines `.tap-target` / `.pt-safe-top` / `.pb-safe-bottom` utilities and the drawer/scrim keyframes + `prefers-reduced-motion` collapse. |
| `components/web-ui/src/styles/tailwind-mobile-plugin.ts` | Tailwind plugin exposing mobile typography tokens (`text-mobile-*`, `leading-mobile-*`, `tracking-mobile-*`). |

## 6. Mobile Admin / Settings / Project Create-Edit

These are mobile-only routes. On a desktop client each one is `<Navigate to="/" replace />` (the corresponding functionality lives in the existing desktop admin/settings/project pages). All seven routes render inside a `MobileShell` whose `onBack` defaults to `navigate(-1)`, so the top bar shows a back chevron rather than the hamburger. None of these views extend `MobileProjectLayout`, so none of them participate in the `OutletContext`/`PasswordGate` plumbing.

### 6.1 Settings, themes, and admin pages

| Route | View | Purpose |
|-------|------|---------|
| `/settings` | `MobileSettings` | App-level preferences: app title, default theme, plus three admin tabs (Models, Users, Groups). Renders `MobileTabBar` (`General` / `Models` / `Users` / `Groups`) and the shared `ModelsTab` / `UsersTab` / `GroupsTab` inside a scrollable body. |
| `/themes` | `MobileThemes` | Lists every theme from `useThemeContext()` and calls `setTheme` on selection. |
| `/models` | `MobileModelsAdmin` | Thin wrapper around the shared `ModelsTab`. |
| `/users` | `MobileUsersAdmin` | Thin wrapper around the shared `UsersTab`. |
| `/groups` | `MobileGroupsAdmin` | Thin wrapper around the shared `GroupsTab`. |

`MobileSettings` is the only "compound" view among these: it hosts its own `MobileTabBar` so a single URL serves four different sub-sections. The other four routes are direct mounts of the shared admin tabs with mobile chrome added.

The admin pages (`/models`, `/users`, `/groups`) and the admin tabs inside `/settings` consume the same backend endpoints (`/api/models`, `/api/users`, `/api/groups`, `/api/themes`, `/api/settings`) as the desktop pages — see [web-ui.md](web-ui.md) §4 and [web-ui-subsystems.md](web-ui-subsystems.md).

### 6.2 Project create / edit (`MobileProjectCreate`, `MobileProjectEdit`)

Both views reuse the shared `ProjectForm` (`components/web-ui/src/components/projects/ProjectForm.tsx`) inside a mobile wrapper, and break the form into four collapsible sections via `MobileAccordion`:

```
MobileProjectCreate | MobileProjectEdit
 ├─ MobileShell (onBack → navigate(-1), title="New project" | "Edit project")
 │   ├─ MobileTabBar     (General / Repository / Build & Exec / Models)
 │   ├─ <section> per tab — wraps ProjectForm fields in MobileAccordion
 │   ├─ MobileFieldValidationBanners  (per-field status, driven by ValidationStep[])
 │   ├─ MobileValidationSummary       (aggregated step status list)
 │   └─ <Submit button>               (disabled until validation passes)
```

Validation pipeline (`components/web-ui/src/lib/project-validation.ts`):

- `INITIAL_VALIDATION_STEPS` and `EDIT_VALIDATION_STEPS` are arrays of `ValidationStep` (id, label, status, message). The create set includes a repo-reachability check and a model-fetch check; the edit set is the same minus the create-only steps.
- `runCreateValidation(formData)` / `runUpdateValidation(formData)` execute the relevant steps in order, mutating the `status`/`message` of each, and return the updated array. Steps are awaited sequentially so each banner updates live (`running` → `success` / `error`).
- `MobileValidationSummary` reads the array and renders one row per non-pending step. `MobileFieldValidationBanners` reads the array and renders one banner under each form field whose id matches a step's `id`.

Submission: `MobileProjectCreate` posts `POST /api/projects` (admin only — the server enforces this, see [core/auth.md](../core/auth.md)); `MobileProjectEdit` reads `id` from `useParams`, preloads via `GET /api/projects/:id`, and `PUT`s back to `/api/projects/:id`. On success both navigate to the new/edited project's mobile view. The admin-only "New project" row in `MobileProjectsList` is the in-drawer entry point to `/projects/new`.

### 6.3 Login / change-password (mobile)

`MobileLogin` and `MobileChangePassword` are full implementations of the desktop auth pages, mobile-styled:

- `MobileLogin` posts to `POST /api/auth/login`; on success it honors `?from=` (defaults to `/`) and the server's `resetRequired` flag by navigating to `/change-password?redirect=<from>`. See [core/auth.md](../core/auth.md) for the request/response contract.
- `MobileChangePassword` posts to `POST /api/auth/change-password`; on success it navigates to `?redirect=` (defaults to `/`).

`MobilePlanPage` (`/projects/:id/plan`) is a horizontal **list/panel slider** — there is no nested `<Routes>`; the two panes are absolutely-positioned siblings whose translateX is driven by a single `phase: 'list' | 'panel'` state. Navigation between panes is encoded in the URL via `?chat=<id>`, so deep-linking, browser back/forward, and `popstate` all work without custom routing.

## 7. Mobile Plan Page — Chat List ↔ Chat Panel

### View stack (`useViewStack.ts`)

`useViewStack` is the URL contract for the panel. It reads `?chat=<id>` from `useSearchParams`, derives `{ view, activeChatId }`, and exposes:

| Method | URL effect | History |
|--------|-----------|---------|
| `push(id)` | `set ?chat=id` | new entry |
| `select(id)` | `set ?chat=id` | replace (in-place switching, no back stack growth) |
| `back()` | `delete ?chat` | pop |

`view === 'panel'` iff `activeChatId !== null`. `MobilePlanPage` listens to `popstate` and calls `back()` so the OS back button exits the panel even when the user arrived via a deep link with `?chat=` already set.

### Panes

```
MobilePlanPage (phase controlled by useViewStack().view)
 ├─ MobileChatListView                  (phase==='list' → translate-x-0)
 │    ├─ header: "Chats" + "+" opens MobileNewChatSheet
 │    ├─ list: GET /api/chats?projectId= (skeletons, empty state)
 │    ├─ per-row: handleOpen → POST /api/chatOpen → onSelect → stack.push
 │    └─ per-row: trash → confirm dialog → POST /api/chatDelete
 └─ MobileChatPanelView                 (phase==='panel' → translate-x-0)
      ├─ MobileChatPanelHeader           (title from onHeaderInfo, back btn)
      ├─ STAGE_DISPATCH resolves chat → one of:
      │    ChatCollecting / ChatDomain / ChatPlan / ChatVerify / ChatInit /
      │    ChatAnalysis / ChatFinalAssessment / ChatRequirement / ChatRequirementUpload
      └─ useSwipeBack                    (left-edge swipe → stack.back)
```

- Both panes are mounted at all times; only their transform changes. Transition is 300 ms `cubic-bezier(0.4,0,0.2,1)`, collapsed to 1 ms by the global `prefers-reduced-motion` rule.
- The panel pane is `aria-hidden` whenever `phase === 'list'` so screen readers announce only the visible pane.
- The list **owns its own `chats` state** via `useChatListWebSocket`; `MobilePlanPage` keeps a separate copy so it can resolve `activeChat` when navigating by URL.

### Live data

- **`MobileChatListView`** subscribes to `useChatListWebSocket(projectId, { onChatUpdated, onChatCreated, onChatDeleted })`. Mutations are patched locally — no full refetch.
- **`MobilePlanPage`** also subscribes to `useChatListWebSocket` so its `activeChat` (resolved by id) reflects `stage` / `sub_stage` / `error_type` / `running` updates even while the panel is open. If `chat_deleted` fires for the currently active chat, the page calls `stack.back()` automatically.
- Once the list finishes loading, `MobilePlanPage` validates `activeChatId` against the loaded chats; if the id from the URL doesn't exist (e.g. deep link to a deleted chat), it shows a toast and pops the stack (one-shot `skipNextPhaseSync` flag prevents the resulting `back()` from immediately re-setting `phase === 'panel'`).
- The chat panel itself does **not** open a second WebSocket — it relies on `MobilePlanPage`'s subscription to keep `activeChat` fresh, and re-renders the shared stage component with the updated `chat` prop. Per-chat live messages, streaming, and stage-specific WS are still handled inside each `Chat*` component (desktop parity).

### Scroll memory

`MobilePlanPage` keeps `scrollPositionsRef: Map<number, number>`. On `MobileChatListView` selection the entry is seeded with `0`; `MobileChatPanelView` saves the panel's `scrollTop` on unmount and restores it on mount via `requestAnimationFrame`. Reopening the same chat from the list or via deep link returns the user to where they left off.

### Cross-cutting

- `MobilePlanPage` consumes `OutletContext` of shape `{ project, projectId, liveStatus }` (see §4) — only `projectId` is used by the plan view.
- `useToast` (`@/context/ToastContext`) is used for the "Chat not found" deep-link fallback and for delete-failure messages.
- `MobileNewChatSheet` posts to `/api/chatStart` (the same endpoint the desktop "New Chat" dialog uses) and, on success, the WS `chat_created` event delivers the new row to the list without an extra refetch.

## 8. Wiring / Data Flow (router)

```
App.tsx
  └─ AuthProvider
       └─ SecurityRouter                          (App.tsx:37-156)
            ├─ loading / not authed               (existing early-returns)
            └─ <React.Suspense>                   (App.tsx:79)
                 └─ <Routes>                      (App.tsx:80-152)
                      ├─ "/"                    → isMobile ? MobileHome           : HomePage
                      ├─ "/login"               → isMobile ? MobileLogin          : LoginPage
                      ├─ "/change-password"     → isMobile ? MobileChangePassword : ChangePasswordPage
                      ├─ "/projects/:id"        → isMobile ? MobileProjectLayout  : ProjectLayout
                      │     ├─ index            → isMobile ? MobileProjectPage    : ProjectPage
                      │     └─ plan             → isMobile ? MobilePlanPage       : PlanPage
                      ├─ "/settings"            → isMobile ? MobileSettings       : <Navigate to="/" replace />
                      ├─ "/themes"              → isMobile ? MobileThemes         : <Navigate to="/" replace />
                      ├─ "/models"              → isMobile ? MobileModelsAdmin    : <Navigate to="/" replace />
                      ├─ "/users"               → isMobile ? MobileUsersAdmin     : <Navigate to="/" replace />
                      ├─ "/groups"              → isMobile ? MobileGroupsAdmin    : <Navigate to="/" replace />
                      ├─ "/projects/new"        → isMobile ? MobileProjectCreate  : <Navigate to="/" replace />
                      ├─ "/projects/:id/edit"   → isMobile ? MobileProjectEdit    : <Navigate to="/" replace />
                      └─ "*"                    → Navigate to "/"
```

- The mobile branch is **not** a separate `<Routes>` subtree — it is a per-element ternary inside one `<Routes>` block. Each path resolves to either the mobile or the desktop component; the desktop tree is never rendered on a mobile client and vice versa.
- The mobile `/projects/:id` layout is `MobileProjectLayout` (not the desktop `ProjectLayout`); `App.tsx` selects it via the `isMobile ? … : <ProjectLayout />` ternary.
- `MobileHome` wraps its content in `<MobileShell>` with no `projectId` (so the drawer shows the projects list, the always-on `MobileGlobalNav`, and `MobileAuthMenu`); `MobileProjectLayout` wraps content in `<MobileShell title={project.name}>` with `projectId`/`activeProjectId` (so the drawer also shows `MobileProjectNav`), plus a `<PasswordGate>` when `project.password_hash` is set, plus a `rightSlot` showing the live orchestrator status pill.
- The seven mobile-only admin/settings/edit routes (`/settings`, `/themes`, `/models`, `/users`, `/groups`, `/projects/new`, `/projects/:id/edit`) all redirect to `/` on a desktop client — they exist only to give mobile users access to functionality that on desktop lives in the persistent sidebar.
- Lazy chunks: each `React.lazy(() => import(...))` (`App.tsx:12-62`) puts a mobile view into its own JS chunk, so a desktop client never downloads mobile code (and vice versa).
- Auth flow is unchanged — `SecurityRouter` still gates by `useAuth()` before the routes render, and `MobileProjectLayout` reuses the same `requireAuth` → `requireProjectAccess` server middleware via the existing `/api/projects/*` endpoints. Server-side admin checks (`requireAdmin`) gate `/api/users`, `/api/groups`, `/api/models`, and `POST/PUT /api/projects`; mobile clients rely on `useAuth().isAdmin` to hide the admin rows from the drawer, but the server is the source of truth.

## 9. Cross-Component Contracts (mobile)

- **`MobileShell` props** (`open`, `onOpenChange`, `title?`, `rightSlot?`, `activeProjectId?`, `projectId?`, `onSelectProject?`, `onBack?`, `children`) — `projectId` is the signal that toggles `MobileProjectNav` rendering inside the drawer; without it only the projects list, `MobileGlobalNav`, and `MobileAuthMenu` show. `rightSlot` is opaque — `MobileProjectLayout` passes a status pill, admin/settings views typically pass nothing. Supplying `onBack` switches the top-bar lead button from hamburger to back chevron; the default behavior is `navigate(-1)`. `MobileProjectLayout` deliberately omits `onBack` (the project view is a top-level destination).
- **`MobileDrawer` props** (`open`, `onClose`, `activeProjectId?`, `onSelectProject?`, `projectId?`, `triggerRef?`, `onNavigate?`) — `projectId` toggles `MobileProjectNav`; `onNavigate(path)` overrides the drawer's default `react-router` `navigate` and is supplied by `MobileShell` (which forwards its own `navigate`). All nav rows close the drawer after invoking `onNavigate`.
- **`MobileProjectNav` props** (`projectId`, `onNavigate?`) — `onNavigate` is the same callback the drawer uses; without it each row falls back to `useNavigate()`. The Settings row navigates to `/settings`.
- **`MobileProjectsList` props** (`activeProjectId?`, `onSelect`, `onCreateProject?`) — when both `isAdmin` (from `useAuth()`) and `onCreateProject` are present, the list prepends a "New project" row that calls `onCreateProject` (the drawer wires this to navigate to `/projects/new` and close).
- **`OutletContext`** from `MobileProjectLayout` — `{ project: Project, projectId: number, liveStatus: 'running' | 'stopped' | undefined }`. `MobileProjectPage` consumes it via `useOutletContext<{ project, projectId, liveStatus }>()`. `MobilePlanPage` consumes the same context (only `projectId` is read). The admin/settings/edit views do **not** mount inside this layout, so they have no `OutletContext`.
- **`MobileTabBar` props** (`items`, `activeId`, `onChange`) — pure controlled component used by `MobileSettings` to switch between its four section tabs. Sticky below the 56 px top bar.
- **`MobileAccordion` props** (`title`, `defaultOpen?`, `open?`, `onOpenChange?`, `badge?`, `children`) — Radix-Collapsible wrapper used by `MobileProjectCreate` / `MobileProjectEdit` to break `ProjectForm` into General / Repository / Build & Exec / Models sections.
- **`ValidationStep`** (from `lib/project-validation.ts`) — `{ id, label, status: 'pending' | 'running' | 'success' | 'error', message?: string }`. `MobileValidationSummary` and `MobileFieldValidationBanners` both consume an array of these and render the same status with different visual treatments (summary list vs per-field banner). Steps are produced by `runCreateValidation` / `runUpdateValidation`.
- **`useProjectStatus(projectId)`** — shared WebSocket-backed hook (see [web-ui-subsystems.md](web-ui-subsystems.md)) used identically by desktop and mobile layouts.
- **`useChatListWebSocket(projectId, handlers)`** — see [web-ui-subsystems.md](web-ui-subsystems.md). On mobile it is consumed **twice** in the plan view: once in `MobileChatListView` (owns the list state) and once in `MobilePlanPage` (so the panel's `activeChat` reflects live `stage`/`sub_stage` updates). Both subscriptions live on the same `/ws?projectId=…` channel; the server fans out identical events to each subscriber.
- **`useWebSocket` + `useWorkItems`** — same hooks the desktop `ProjectPage` uses; on mobile `MobileProjectPage` filters the WS stream to `WsJobUpdateMessage` (`type === 'job_update'`) and feeds `useWorkItems({ projectId, jobUpdates })` so the list updates live.
- **`AddJobDialog`** — desktop dialog reused as-is on mobile; mounted at the bottom of `MobileProjectPage` and closed via `onOpenChange`.
- **`EditProjectDialog`** — desktop dialog with `variant: 'modal' | 'sheet'`. The mobile "sheet" variant is **no longer used** — project editing moved to the dedicated `/projects/:id/edit` route (`MobileProjectEdit`). The desktop `EditProjectDialog` still uses the default modal variant.
- **`JobDetailContent`** — refactored out of `JobDetailModal` and accepts `variant: 'modal' \| 'stacked'`. The mobile path (`MobileJobDetailStack`) uses `stacked`; the desktop `JobDetailModal` wraps it in the cockpit shell with the default `modal` variant.
- **`ProjectForm`** — shared create/edit form component. Reused unchanged by `MobileProjectCreate` / `MobileProjectEdit`; the mobile wrappers add the `MobileAccordion` section chrome, the `MobileValidationSummary` + `MobileFieldValidationBanners` UX, and the mobile submit button.
- **`ModelsTab` / `UsersTab` / `GroupsTab`** — shared admin panels reused by both `MobileSettings` (under their respective tabs) and the standalone admin routes (`MobileModelsAdmin` / `MobileUsersAdmin` / `MobileGroupsAdmin`). No mobile-specific variants — the mobile wrappers force a single-column grid and a 44 px min-height on every button via Tailwind arbitrary selectors.
- **Job selection is local, chat selection is URL-routed** — opening a job on mobile sets `selectedJobId` in `MobileProjectPage` state (browser back exits the project); opening a chat pushes `?chat=<id>` on `/projects/:id/plan` via `useViewStack.push` so back/forward and deep links navigate the panel. This split exists because jobs are a transient overlay (one project, many jobs), while chats are addressable long-lived sessions (deep-linkable from notifications / shared URLs).
- **`Chat*` stage components** — desktop components reused as-is on mobile. `MobileChatPanelView` re-runs `STAGE_DISPATCH` on every render so the resolved component tracks `chat.stage`/`sub_stage`/`mode` updates from the panel's `activeChat`. See [core/web-ui-state-machine.md](../core/web-ui-state-machine.md) for the stage inventory.

## 10. Mobile Sheet & Confirm-Dialog Primitives

Two new primitives sit at the base of every mobile modal/sheet in the layer, replacing the previous pattern of mounting the desktop `Dialog` directly inside a mobile view.

### 10.1 `MobileSheet` (`components/web-ui/src/components/ui/mobile-sheet.tsx`)

A Radix-Dialog-based sheet with viewport-aware sizing and a `variant: 'bottom' | 'full'` prop. Contract:

- Props: `open`, `onOpenChange`, `title`, `description?`, `variant?` (default `'bottom'`), `footer?`, `dismissable?` (default `true`), `children`. `title` and `footer` accept `ReactNode`, so callers can pass icons, badges, or action buttons directly into the header/footer slots.
- Viewport detection — `detect()` (`mobile-sheet.tsx:9-19`) returns `'tablet'` if `window.matchMedia('(min-width: 641px)').matches`, otherwise `'phone'`. SSR-safe (returns `'phone'` when `window` is undefined). The viewport tag drives the sheet's max-width and rounded-corner treatment.
- Animations / scrim / Escape / body-scroll-lock reuse the same Radix `Dialog` plumbing that `DialogContent` already exposes; the `MobileSheet` re-uses `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose` from the existing `ui/dialog` shim, so the existing `dialog.tsx` mock in `tests/components/mobile/_setup.ts` works for these tests too.
- The X close button is suppressed at the `DialogContent` level via the new `showCloseButton` prop on `DialogContent` (`components/web-ui/src/components/ui/dialog.tsx:28-43`) — `MobileSheet` always passes `showCloseButton={false}` and renders its own header close button instead. The `showCloseButton` prop is opt-in for other callers; the default keeps the existing close-button behavior.

### 10.2 `MobileConfirmDialog` (`components/web-ui/src/components/ui/mobile-confirm-dialog.tsx`)

A `MobileSheet`-backed confirm dialog used everywhere the mobile layer used to mount a `Dialog` directly. Contract:

- Props: `open`, `onOpenChange`, `title`, `description?`, `confirmLabel`, `cancelLabel?` (default `'Cancel'`), `variant?: 'destructive' | 'default'` (default `'default'`), `onConfirm: () => void | Promise<void>`, `loading?` (default `false`).
- The component owns a `busy` flag: if `onConfirm` returns a promise, `busy` is held until it resolves and the confirm button shows a spinner and is disabled. The `loading` prop lets callers force a busy state when they manage the await themselves.
- The "delete chat" flow in `MobileChatListView`, the "regenerate plan" / "regenerate requirement" confirmations in `ChatPlan` / `ChatRequirement`, and the destructive actions inside `MobileAddJobSheet`, `MobileUsersBody`, and `MobileGroupsBody` all flow through this component.

### 10.3 Where the primitives are consumed

- `MobileSheet` direct callers: `MobileAddJobSheet`, `MobileSseSheet`, `MobileJobInfoSheet`, `MobileUsersBody`, `MobileGroupsBody`, and `MobileConfirmDialog` (which is itself a `MobileSheet` wrapper).
- `MobileConfirmDialog` callers: `MobileChatListView` (delete chat), `ChatPlan` and `ChatRequirement` (regenerate confirmations — both lazy-import the dialog so desktop bundles stay clean; see §11.1), `MobileAddJobSheet` (discard unsaved edits), `MobileUsersBody` (delete user), `MobileGroupsBody` (delete group).

The desktop `Dialog` is no longer used in any mobile-only view for confirmation flows. `ChatPlan` and `ChatRequirement` keep the desktop `Dialog` branch for non-mobile clients and switch to the `MobileConfirmDialog` only when `useIsMobile()` is true, so the lazy import never executes on desktop.

## 11. Mobile-Native Admin Bodies & Sheets

These views were previously thin shells around the shared `UsersTab` / `GroupsTab` components; they are now self-contained mobile bodies that use the `MobileSheet` / `MobileConfirmDialog` primitives and own their own data fetching. The model is: **mobile gets a body component that looks and behaves like the desktop tab, not a wrapper that forces the desktop tab into a mobile layout**.

### 11.1 Users & Groups (`MobileUsersBody`, `MobileGroupsBody`)

```
MobileUsersAdmin / MobileGroupsAdmin
 └─ MobileShell (back chevron, title "Users" / "Groups")
      └─ <div px-4 pb-safe-bottom>
           └─ MobileUsersTab / MobileGroupsTab (self-contained)
                ├─ header row: title + "Add" button → opens create MobileSheet
                ├─ list rows: each opens edit MobileSheet (or triggers delete confirm)
                ├─ MobileSheet (create / edit form)
                ├─ MobileSheet (reset-password form)               — users only
                └─ MobileConfirmDialog (delete)                    — both
```

Key wiring:

- `MobileUsersBody` (alias `MobileUsersTab`) calls `/api/users` (GET/POST), `/api/users/:id` (PUT/DELETE), and `/api/users/:id/password` (PUT for the reset-password flow). All three are admin-gated; see [core/auth.md](../core/auth.md).
- `MobileGroupsBody` (alias `MobileGroupsTab`) calls `/api/groups` (GET/POST/PUT/DELETE) plus `/api/users` and `/api/projects` (GET, to populate the member and project multi-selects in the create/edit sheets).
- Each body owns its own `fetchUsers` / `fetchGroups` state and refetches after a successful mutation — there is no shared cache or hook between this body and any desktop component.
- The desktop `UsersTab` / `GroupsTab` are no longer mounted by any mobile route. `MobileSettings` still mounts the shared `UsersTab` / `GroupsTab` under its "Users" and "Groups" tabs (see §6.1); the standalone `/users` and `/groups` routes are the only consumers of the new mobile bodies.

### 11.2 Add/Edit Job Sheet (`MobileAddJobSheet`)

`MobileAddJobSheet` (`components/web-ui/src/components/mobile/MobileAddJobSheet.tsx`) replaces `AddJobDialog` in `MobileProjectPage` (the only consumer). Same backend, different chrome:

- Props: `open`, `onOpenChange`, `projectId`, `jobs` (full job list, for the dependency picker), `onCreated`, `editJob?`. When `editJob` is set the form pre-fills `title`, `description` (HTML stripped via the local `stripHtml` helper), and `depends_on` (parsed from the JSON-encoded column); submission then `PUT`s `/api/projects/:id/jobs/:jobId` instead of `POST`-ing.
- The dependency picker is a custom searchable combobox (input + dropdown), not a Radix primitive — it filters `jobs` by `title` or `id`, hides the row being edited, and tracks selection with a chip list above the input.
- A `dirty` flag (memoized over `title`, `description`, `selectedDeps`) is compared against the original `editJob` (or empty on create) to decide whether closing the sheet should prompt the `MobileConfirmDialog` ("Discard unsaved changes?"). On `next === false` with `dirty === true` the sheet stays open and the confirm dialog is presented; only after the user confirms does `onOpenChange(false)` fire.
- The `onCreated` callback is unchanged from `AddJobDialog`; `MobileProjectPage` still calls `refetch()` on the new sheet, but **does not** call `refetch()` on edit — the live `useWorkItems` WS stream picks the edit up (see §3).

### 11.3 Job Info Sheet (`MobileJobInfoSheet`)

`MobileJobInfoSheet` is a `MobileSheet` wrapper around the job's full description. It is **not mounted directly** anywhere — `JobDetailContent` (`JobDetailModal.tsx:540-545, 1020-1028`) lazy-imports it and renders it conditionally on `useIsMobile()`. When `isMobile` is true the `JobInfoModal` is replaced with `<MobileJobInfoSheet job={job} open={infoOpen} onOpenChange={setInfoOpen} />` inside a `<React.Suspense fallback={null}>`. The desktop path is unchanged.

The sheet's `title` slot is a `<span>` with an `Info` icon and the job title (or `'Untitled Job'` when null), `description` is `Job #<id> — full description`, and `variant="full"` is used so the description gets the full viewport (not a bottom drawer). The description is sanitized with `DOMPurify` (no markdown — desktop parity).

### 11.4 SSE Debug Sheet (`MobileSseSheet`)

`MobileSseSheet` (`components/web-ui/src/components/mobile/MobileSseSheet.tsx`) is a mobile debug viewer opened from `MobileSettings` → "Open SSE feed". Behavior:

- The user enters a chat ID into the General tab of `MobileSettings`; pressing "Open" validates it (`Number.isFinite && > 0`), stores the parsed id in `MobileSettings` state, and opens the sheet.
- The sheet opens a raw `WebSocket` to `${proto}//${host}/ws?chatId=<n>` (the same WS channel the desktop SSE debug console uses), accumulates every `rawSse` frame into a read-only `<textarea>`, and auto-scrolls to the bottom on append.
- The WebSocket is closed and the buffer cleared on sheet close; reopening with a new chat id reconnects. There is no reconnection logic — this is a debug surface, not a production viewer.

The component is consumed **only** by `MobileSettings` (it is imported and rendered with `sseChatId` as the chat id); it is not part of the `MobileSettings` props contract or any other view.

## 12. Mobile Styling Foundation

Cross-cutting mobile styling is wired once at the shell/utility layer so every view (mobile **and** desktop) inherits safe-area handling and a mobile typography scale on small screens.

- **Viewport** — `components/web-ui/index.html` declares `viewport-fit=cover, maximum-scale=5.0` so iOS notches / Android cutouts are honored and pinch-to-zoom is preserved.
- **Safe-area insets** — `components/web-ui/src/globals.css` applies `padding-{top,right,bottom,left}: env(safe-area-inset-*)` on `body`. Per-component insets use the `.pt-safe-top` / `.pb-safe-bottom` utilities (also in `globals.css`).
- **Tap-target utilities** — `.tap-target` (44×44) and `.tap-target-lg` (48×48) enforce minimum touch target sizes; applied to every interactive button in the mobile shell/drawer/nav.
- **Tailwind mobile plugin** — `components/web-ui/src/styles/tailwind-mobile-plugin.ts` is registered via `@plugin "./styles/tailwind-mobile-plugin"` in `globals.css`. It exposes:
  - CSS variables on `:root`: `--text-mobile-h1/h2/h3/body/caption`, `--leading-mobile-tight/normal`, `--tracking-mobile-tight/normal`.
  - Tailwind `text-*` utilities (`text-mobile-h1` … `text-mobile-caption`), `leading-mobile-{tight,normal}`, `tracking-mobile-{tight,normal}` backed by those vars.
- **Animation utilities** — `globals.css` defines keyframes (`mobile-drawer-in/out`, `mobile-scrim-in/out`, all 300 ms `cubic-bezier(0.4, 0, 0.2, 1)`) and the `.animate-mobile-*` utilities; collapsed to 1 ms under `@media (prefers-reduced-motion: reduce)`.

These tokens are the canonical place to add mobile-first typography/spacing/animation rules; do not duplicate mobile overrides in view-level CSS.

## 13. Integration Points

- **Hook consumer**: `useIsMobile` is consumed by `SecurityRouter` (`App.tsx:40`, per-route ternary), and now also by `JobDetailContent` (`JobDetailModal.tsx:543`) to swap `JobInfoModal` → `MobileJobInfoSheet` and by `ChatPlan` / `ChatRequirement` to swap the regenerate `Dialog` → `MobileConfirmDialog`. Hooks inventory in [web-ui-subsystems.md](web-ui-subsystems.md) is unchanged.
- **Lazy chunks**: mobile components are loaded on demand. There is no separate webpack/vite entry — `App.tsx`'s `React.lazy` calls (`App.tsx:12-62`) create dynamic imports. In addition, `JobDetailContent`, `ChatPlan`, and `ChatRequirement` each `React.lazy`-import their mobile-specific confirmation/sheet so a desktop bundle never pulls `MobileConfirmDialog` / `MobileJobInfoSheet` into its code path.
- **Backend**: no new endpoints. The mobile admin bodies and sheets call the same `/api/users`, `/api/users/:id`, `/api/users/:id/password`, `/api/groups`, and `/api/projects` endpoints the desktop tabs use (see [web-ui.md](web-ui.md) §4 and [web-ui-subsystems.md](web-ui-subsystems.md)). `MobileAddJobSheet` calls `POST` / `PUT /api/projects/:id/jobs[/:jobId]`; `MobileSseSheet` opens a raw `WebSocket` to `/ws?chatId=<n>` (same channel the desktop SSE debug console uses).
- **Drawer navigation plumbing**: `MobileShell` → `MobileDrawer.onNavigate` → `MobileProjectsList.onCreateProject` / `MobileProjectNav.onNavigate` / `MobileGlobalNav.onNavigate` → `react-router.navigate`. The drawer closes itself after every nav call (handled inside `MobileDrawer.tsx` for each section's row callback).
- **Admin gating**: `MobileProjectsList` only renders the "New project" row when `useAuth().isAdmin` is true; `MobileGlobalNav` only renders the Models/Users/Groups rows under the same condition. `MobileUsersBody` / `MobileGroupsBody` are admin-only by route — desktop clients `Navigate to="/"` for `/users` and `/groups`, so the route table is the primary gate; the server-side `requireAdmin` middleware on `/api/users` and `/api/groups` is the secondary gate — see [core/auth.md](../core/auth.md).
- **Dialog primitive change**: `DialogContent` now accepts a `showCloseButton?: boolean` prop (default `true`, set to `false` by `MobileSheet`). Existing desktop callers are unaffected because the prop is opt-in and defaults preserve prior behavior.
- **Test scripts**: `components/web-ui/package.json` `test` script also runs the new mobile tests — `MobileSheet.test.tsx`, `MobileConfirmDialog.test.tsx`, `MobileAddJobSheet.test.tsx`, `MobileJobInfoSheet.test.tsx`, `MobileUsersBody.test.tsx`, `MobileGroupsBody.test.tsx` — plus the existing `MobileShell.test.tsx`, `MobileDrawer.test.tsx`, `MobileHomeProjects.test.tsx`. All of these share the Radix-Dialog happy-dom mock in `tests/components/mobile/_setup.ts` so the modal markup renders inline under `tsx --test`.