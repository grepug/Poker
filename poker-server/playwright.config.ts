import { defineConfig, devices } from '@playwright/test';

const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5174';
const backendPort = process.env.E2E_BACKEND_PORT ?? '3001';
const frontendUrl = `http://localhost:${frontendPort}`;
const backendUrl = `http://localhost:${backendPort}`;

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
      command: `python3 -m http.server ${frontendPort} --directory ../poker-client/dist`,
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      // Avoid watch mode restarts during long e2e runs.
      command:
        `PORT=${backendPort} CORS_ORIGIN=${frontendUrl} CLIENT_URL=${frontendUrl} TEST_MODE=true npm run start`,
      url: backendUrl,
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: backendPort,
        CORS_ORIGIN: frontendUrl,
        CLIENT_URL: frontendUrl,
        TEST_MODE: 'true',
      },
    },
  ],
});
