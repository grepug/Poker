# Agent Notes

## E2E Port/URL Configuration (No Hardcoded Ports)

Use environment variables for Playwright frontend/backend targets. Do **not** hardcode `5174`/`3001` in new e2e code.

Supported vars:
- `PW_FRONTEND_URL` (full URL, overrides host/port pair)
- `PW_BACKEND_URL` (full URL, overrides host/port pair)
- `PW_FRONTEND_HOST` (default: `localhost`)
- `PW_FRONTEND_PORT` (default: `5174`)
- `PW_BACKEND_HOST` (default: `localhost`)
- `PW_BACKEND_PORT` (default: `3001`)
- `PW_FRONTEND_BIND_HOST` (default: frontend hostname)

Defaults remain:
- Frontend: `http://localhost:5174`
- Backend: `http://localhost:3001`

## Runtime Backend Wiring for Client

Playwright serves built frontend assets from `poker-client/dist`. Because Vite env vars are compile-time, runtime backend switching is handled by:
- `window.__POKER_RUNTIME_CONFIG__`
- injected script: `/runtime-config.js`
- socket resolution in `poker-client/src/services/socket.service.ts`

During Playwright startup, frontend prep script writes runtime backend URL and patches `dist/index.html` so runtime config loads before the module script.

Prep script:
- `poker-server/test/e2e/scripts/prepare-frontend-dist.cjs`

## How to Run Smoke on Alternate Ports

From `poker-server`:

```bash
PW_FRONTEND_PORT=5188 PW_BACKEND_PORT=3015 npm run test:e2e:playwright:smoke
```

Expected browser console behavior in test logs:
- `Connected to server http://localhost:3015` (or your configured backend URL)

## Using PM2 for Manual Browser Testing

Use `pm2` when you need frontend/backend dev servers to keep running while you continue working in the terminal (for example, when a human is manually testing in a browser).

Recommended naming:
- `poker-server-<port>`
- `poker-client-<port>`

Example (`backend:3025`, `frontend:5199`):

```bash
PORT=3025 HOST=0.0.0.0 CORS_ORIGIN=http://localhost:5199 CLIENT_URL=http://localhost:5199 \
  pm2 start npm --name poker-server-3025 --cwd poker-server -- run start:dev

VITE_SERVER_PROTOCOL=http VITE_SERVER_HOST=localhost VITE_SERVER_PORT=3025 \
  pm2 start npm --name poker-client-5199 --cwd poker-client -- run dev -- --host localhost --port 5199
```

Useful commands:
- `pm2 ls`
- `pm2 logs poker-server-3025`
- `pm2 logs poker-client-5199`
- `pm2 stop poker-server-3025 poker-client-5199`
- `pm2 delete poker-server-3025 poker-client-5199`

### Manual QA Flow (Tray Presets / Action Buttons)

When manually validating betting preset labels/behavior (for example `3-Bet` replacement, clamp/disable logic):

1. Start/restart backend + frontend with explicit `--cwd` pointing to the **current worktree**.
2. Confirm PM2 process paths before testing:
   - `pm2 describe poker-client-<port> | rg "exec cwd"`
   - `pm2 describe poker-server-<port> | rg "exec cwd"`
3. Open the app and test both paths:
   - **Facing a bet**: verify `Call`, `Raise`, `All-In` behavior and amounts.
   - **No bet facing**: verify `Min Bet`, `Bet`, `All-In` behavior and amounts.
4. Verify short-stack behavior:
   - Non-all-in presets that clamp to stack and resolve as all-in must be disabled.
   - Only the explicit all-in preset should remain enabled.
5. Cross-check with targeted e2e on alternate ports if needed:
   - `PW_FRONTEND_PORT=5188 PW_BACKEND_PORT=3015 npm run test:e2e:playwright -- --project comprehensive-e2e --workers=1 --grep "8.2c|8.2d" --reporter=line`

### Manual QA Pitfalls (Seen in Real Debugging)

- **PM2 running from old worktree**: restarting an existing PM2 process does not change its `exec cwd`. If UI looks stale, delete and recreate process with correct `--cwd`.
- **Browser cache/PWA cache**: stale assets can keep old labels (e.g. still showing `3-Bet`).
  - Hard refresh: `Cmd+Shift+R`
  - If still stale: DevTools → Application → Service Workers `Unregister`, then `Clear site data`.
- **Assuming port is enough**: matching ports (`5174/3001`) does not guarantee correct code version; always verify `exec cwd`.
- **Quick source sanity check for label changes**:
  - `curl -s http://localhost:5174/src/i18n/messages.ts | rg "threeBet|3-Bet|game\\.preset\\.raise|game\\.preset\\.bet"`
  - If `threeBet`/`3-Bet` appears, frontend is not serving expected code.

## Guardrails

- Keep tests and config env-driven.
- If client still connects to `3001`, verify:
  - `runtime-config.js` is requested by browser
  - `runtime-config.js` is loaded before the main module in `dist/index.html`
  - Playwright is serving freshly built `dist`

## Default Delivery Workflow

- Unless the user explicitly asks otherwise, continue executing tasks end-to-end until the work is ready to be submitted as a PR; avoid pausing for intermediate check-ins/questions.
- Default PR base branch is `codex/staging`.
- Before creating a PR, first pull the latest target/base branch and check for conflicts. If conflicts exist, resolve them before opening the PR.
