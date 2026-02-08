import { defineConfig, devices } from '@playwright/test';

const DEFAULT_FRONTEND_URL = `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
const DEFAULT_BACKEND_URL = `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;

const FRONTEND_TARGET = new URL(process.env.PW_FRONTEND_URL ?? DEFAULT_FRONTEND_URL);
const BACKEND_TARGET = new URL(process.env.PW_BACKEND_URL ?? DEFAULT_BACKEND_URL);

const FRONTEND_URL = FRONTEND_TARGET.origin;
const BACKEND_URL = BACKEND_TARGET.origin;
const FRONTEND_PORT = FRONTEND_TARGET.port || '80';
const BACKEND_PORT = BACKEND_TARGET.port || '80';
const FRONTEND_BIND_HOST =
  process.env.PW_FRONTEND_BIND_HOST ?? FRONTEND_TARGET.hostname;

const prepareFrontendCommand = `node ./test/e2e/scripts/prepare-frontend-dist.cjs ${BACKEND_URL}`;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true, // Run tests in parallel - each test uses isolated browser contexts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 3, // Allow parallel execution
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
      command:
        `PORT=${BACKEND_PORT} CORS_ORIGIN=${FRONTEND_URL} CLIENT_URL=${FRONTEND_URL} TEST_MODE=true npm run start`,
      url: BACKEND_URL,
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: BACKEND_PORT,
        CORS_ORIGIN: FRONTEND_URL,
        CLIENT_URL: FRONTEND_URL,
        TEST_MODE: 'true',
      },
    },
  ],
});
