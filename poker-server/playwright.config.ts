import { defineConfig, devices } from '@playwright/test';

const defaultFrontendUrl = `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.E2E_FRONTEND_PORT ?? process.env.PW_FRONTEND_PORT ?? '5174'}`;
const defaultBackendUrl = `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.E2E_BACKEND_PORT ?? process.env.PW_BACKEND_PORT ?? '3001'}`;

const FRONTEND_TARGET = new URL(
  process.env.E2E_FRONTEND_URL ??
    process.env.PW_FRONTEND_URL ??
    defaultFrontendUrl,
);
const BACKEND_TARGET = new URL(
  process.env.E2E_BACKEND_URL ??
    process.env.PW_BACKEND_URL ??
    defaultBackendUrl,
);

const FRONTEND_URL = FRONTEND_TARGET.origin;
const BACKEND_URL = BACKEND_TARGET.origin;
const FRONTEND_PORT =
  FRONTEND_TARGET.port || (FRONTEND_TARGET.protocol === 'https:' ? '443' : '80');
const BACKEND_PORT =
  BACKEND_TARGET.port || (BACKEND_TARGET.protocol === 'https:' ? '443' : '80');
const FRONTEND_BIND_HOST =
  process.env.E2E_FRONTEND_BIND_HOST ??
  process.env.PW_FRONTEND_BIND_HOST ??
  FRONTEND_TARGET.hostname;

const prepareFrontendCommand = `node ./test/e2e/scripts/prepare-frontend-dist.cjs ${BACKEND_URL}`;
const parsedWorkers = Number.parseInt(process.env.PW_WORKERS ?? '', 10);
const resolvedWorkers =
  Number.isFinite(parsedWorkers) && parsedWorkers > 0
    ? parsedWorkers
    : 1;

export default defineConfig({
  testDir: './test/e2e',
  // The e2e suite shares a single backend in TEST_MODE and is not worker-safe.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: resolvedWorkers, // Allow parallel execution; override with PW_WORKERS
  reporter: 'html',
  timeout: 60000, // 60 second timeout for tests

  use: {
    trace: 'on-first-retry',
    proxy: undefined, // Disable proxy
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'comprehensive-e2e',
      testMatch: 'comprehensive-poker.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
    {
      name: 'debug',
      testMatch: 'debug-*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        headless: false, // Show browser for debugging
      },
    },
  ],

  // Start both frontend and backend before tests
  webServer: [
    {
      // Use prebuilt static assets for stability under Node versions that
      // may not meet Vite dev-server requirements.
      command: `npm --prefix ../poker-client run build && ${prepareFrontendCommand} && python3 -m http.server ${FRONTEND_PORT} --bind ${FRONTEND_BIND_HOST} --directory ../poker-client/dist`,
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      // Avoid watch mode restarts during long e2e runs.
      command: `PORT=${BACKEND_PORT} CORS_ORIGIN=${FRONTEND_URL} CLIENT_URL=${FRONTEND_URL} TEST_MODE=true CHAT_RATE_LIMIT_COUNT=500 CHAT_RATE_LIMIT_WINDOW_MS=10000 CHAT_PAGE_SIZE=20 npm run start`,
      url: BACKEND_URL,
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: BACKEND_PORT,
        CORS_ORIGIN: FRONTEND_URL,
        CLIENT_URL: FRONTEND_URL,
        TEST_MODE: 'true',
        CHAT_RATE_LIMIT_COUNT: '500',
        CHAT_RATE_LIMIT_WINDOW_MS: '10000',
        CHAT_PAGE_SIZE: '20',
      },
    },
  ],
});
