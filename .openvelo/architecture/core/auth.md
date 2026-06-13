# Authentication & Authorization

OpenVelo has a complete auth subsystem in the web-ui. The orchestrator and agent run on internal trust — only the web-ui authenticates.

## Storage

### `users` (db.ts:104-114)
`username` (case-insensitive unique), `password_hash` (bcrypt), `role` (`admin`|`user`), `enabled`, `password_reset_required`, `failed_attempts`, `last_failed_attempt`.

### `groups` / `group_members` / `group_projects` (db.ts:115-131)
A non-admin user is authorized for a project if at least one of their groups contains it (`isUserAuthorizedForProject`).

### `ui_settings` keys
`security_enabled` (default `'false'`), `app_title` (`'OpenVelo'`), `theme` (`'light'`), `debug_sse_console` (`'false'`). When `security_enabled=false`, the system user `{ id: 0, role: 'admin' }` is implied.

## Password Policy (`src/lib/auth.ts:validatePasswordPolicy`)
≥ 8 characters, with uppercase, lowercase, digit, and special character (`!@#$%^&*(),.?":{}|<>`).

## Login Flow (`POST /api/auth/login`)
1. Reject if `security_enabled` is false.
2. `getLoginDelay(username)` = `min(1000 * 2^failed_attempts, 30_000)` ms — awaited as anti-bruteforce.
3. `authenticateUser()` runs `bcrypt.compare`. On failure, `recordFailedLogin()` bumps the counter.
4. On success: `resetFailedLogin()`, `signJwt({ userId, username, role }, secret)` (HS256, 30-day expiry), set the `openvelo-token` HTTP-only cookie (`lax` sameSite, `secure` on HTTPS, 30-day max-age).
5. Return `{ user, resetRequired }`.

`GET /api/auth/me` returns the current user (or 401). `DELETE /api/auth/logout` clears the cookie.

## JWT & Session Secret
- **`src/lib/auth.ts`** — `signJwt` / `verifyJwt` via `jose` (HS256, 30-day expiry). `JwtPayload` = `{ userId, username, role }`.
- **`src/lib/session.ts`** — `getSessionSecret()` lazy-inits and persists a 32-byte random hex secret to `openvelo.session`, located at `<dirname of OPENVELO_DB_PATH>/openvelo.session` (preferred, persistent volume), then `<repoRoot>`, then `<web-ui package dir>`. Deleting the file invalidates all active sessions. `rotateSessionSecret()` is called automatically by `PUT /api/settings` when `security_enabled` is toggled.

## Middleware (`src/api/middleware/auth.ts`)

- **`requireAuth`** — if `security_enabled=false`, attach system user and continue. Otherwise read `openvelo-token` cookie, verify, look up user, check `enabled`, attach `req.user`. 401 on any failure.
- **`requireAdmin`** — wraps `requireAuth`, 403s non-admins.
- **`requireProjectAccess`** — wraps `requireAuth`. Admins pass. Non-admins must have a projectId resolvable from `params.id` / `query.projectId` / `body.project_id` (with chain fallback to `params.chatId` / `query.chatId` / `body.chatId` / `body.chat_id` → resolved via `getChatSession(chatId).project_id`). 403 if not authorized.

`router.ts` mounts `requireAuth` as a global guard for everything except `POST /auth/login`, `DELETE /auth/logout`, `GET /settings`, `GET /themes`, `GET /models`.

## Routes

| Path | Method | Auth | Purpose |
|------|--------|------|---------|
| `/api/auth/login` | POST | none | Login flow (see above). |
| `/api/auth/logout` | DELETE | none | Clear cookie. |
| `/api/auth/me` | GET | cookie | Return current user. |
| `/api/users` | GET / POST | admin | List / create user. |
| `/api/users/:id` | GET / PUT | admin | Fetch / update role or `enabled`. Refuses to drop below 1 enabled admin. |
| `/api/users/me/password` | PUT | cookie | Change own password (requires current). |
| `/api/users/:id/password` | PUT | admin | Reset password (generates 12-char random if omitted). Forces `password_reset_required`. |
| `/api/groups` | GET / POST | admin | List / create group. |
| `/api/groups/:id` | GET / PUT / DELETE | admin | One group CRUD. |
| `/api/settings` | GET | none | Read all settings. |
| `/api/settings` | PUT | admin | Update. Toggling `securityEnabled` rotates the secret. Refuses to enable with no admin. |

## WebSocket Auth
`server.ts:authenticateUpgrade()` mirrors `requireAuth` and protects the `/ws`, `/ws?chatId=`, `/ws?jobId=`, and `/ws/stage/...` upgrade paths. The orchestrator endpoint `/api/orchestrator/ws` is exempt (it's protected by requiring `?projectId=`).

## Frontend
- **`AuthContext`** — current user, `login()`, `logout()`, `checkAuth()`.
- **`PasswordGate`** — wraps the SPA, redirects to `/login` when not authenticated and security is on.
- **`ChangePasswordModal`** — forced password reset modal.
- **`UsersTab` / `GroupsTab`** — admin CRUD UIs in `SettingsModal`.
- **`global-fetch.ts`** — wraps `window.fetch` to dispatch a `openvelo:forbidden` window event on HTTP 403.

## Last-Admin Invariant
`PUT /api/users/:id` refuses to disable the last enabled admin. `PUT /api/settings` refuses to enable security with no admin. The system can always be re-recovered provided security is on and at least one admin remains.

## Cookie Constants (`src/lib/settings.ts`)
```typescript
SESSION_COOKIE = 'openvelo-token'
AUTH_MESSAGE   = 'openvelo-authenticated'
COOKIE_MAX_AGE = 60 * 60 * 24 * 30 * 1000  // 30 days
```
