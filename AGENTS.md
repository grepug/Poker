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

## Guardrails

- Keep tests and config env-driven.
- If client still connects to `3001`, verify:
  - `runtime-config.js` is requested by browser
  - `runtime-config.js` is loaded before the main module in `dist/index.html`
  - Playwright is serving freshly built `dist`
