import path from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const repoRootEnvPath = path.resolve(__dirname, '../.env');

if (existsSync(repoRootEnvPath)) {
  process.loadEnvFile?.(repoRootEnvPath);
}

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
  FRONTEND_TARGET.port ||
  (FRONTEND_TARGET.protocol === 'https:' ? '443' : '80');
const BACKEND_PORT =
  BACKEND_TARGET.port || (BACKEND_TARGET.protocol === 'https:' ? '443' : '80');
const E2E_DATA_DIR = `./.e2e-data/${BACKEND_PORT}`;
const FRONTEND_BIND_HOST =
  process.env.E2E_FRONTEND_BIND_HOST ??
  process.env.PW_FRONTEND_BIND_HOST ??
  FRONTEND_TARGET.hostname;
const includeDebugProject = process.env.PW_INCLUDE_DEBUG_PROJECT === 'true';
const liveRobotE2EEnabled = process.env.PW_LIVE_ROBOT_E2E === '1';

const prepareFrontendCommand = `node ./test/e2e/scripts/prepare-frontend-dist.cjs ${BACKEND_URL}`;

function definedEnv(
  entries: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

const backendEnv = {
  PORT: BACKEND_PORT,
  DATA_DIR: E2E_DATA_DIR,
  CORS_ORIGIN: FRONTEND_URL,
  CLIENT_URL: FRONTEND_URL,
  TEST_MODE: 'true',
  CHAT_RATE_LIMIT_COUNT: '500',
  CHAT_RATE_LIMIT_WINDOW_MS: '10000',
  CHAT_PAGE_SIZE: '20',
  AUTH_PASSWORD_LOGIN_RATE_LIMIT_COUNT: '1000',
  AUTH_PASSWORD_LOGIN_RATE_LIMIT_WINDOW_MS: '1000',
  ...definedEnv({
    AI_ROBOT_API_KEY: process.env.AI_ROBOT_API_KEY,
    AI_ROBOT_BASE_URL: process.env.AI_ROBOT_BASE_URL,
    AI_ROBOT_MODEL_ID: process.env.AI_ROBOT_MODEL_ID,
    AI_ROBOT_API_MODE: process.env.AI_ROBOT_API_MODE,
    AI_ROBOT_TEMPERATURE: process.env.AI_ROBOT_TEMPERATURE,
    AI_ROBOT_MAX_AGENT_STEPS: process.env.AI_ROBOT_MAX_AGENT_STEPS,
    AI_ROBOT_TOOL_RETRY_LIMIT: process.env.AI_ROBOT_TOOL_RETRY_LIMIT,
    AI_ROBOT_ACTION_DELAY_MIN_MS: process.env.AI_ROBOT_ACTION_DELAY_MIN_MS,
    AI_ROBOT_ACTION_DELAY_MAX_MS: process.env.AI_ROBOT_ACTION_DELAY_MAX_MS,
  }),
};

const projects = [
  {
    name: 'comprehensive-e2e',
    testMatch: [
      'comprehensive-poker.spec.ts',
      'robot-lobby-controls.spec.ts',
      'persistence-storage.spec.ts',
    ],
    use: {
      ...devices['Desktop Chrome'],
      headless: true,
    },
  },
];

if (includeDebugProject) {
  projects.push({
    name: 'debug',
    testMatch: ['debug-*.spec.ts'],
    use: {
      ...devices['Desktop Chrome'],
      headless: false,
    },
  });
}

if (liveRobotE2EEnabled) {
  projects.push({
    name: 'live-robot-e2e',
    testMatch: ['robot-live-turn.spec.ts'],
    use: {
      ...devices['Desktop Chrome'],
      headless: true,
    },
  });
}

export default defineConfig({
  testDir: './test/e2e',
  // The e2e suite shares a single backend in TEST_MODE and is not worker-safe.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000, // 60 second timeout for tests

  use: {
    trace: 'on-first-retry',
    proxy: undefined, // Disable proxy
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects,

  // Start both frontend and backend before tests
  webServer: [
    {
      // Use prebuilt static assets for stability under Node versions that
      // may not meet Vite dev-server requirements.
      command: `pnpm --dir .. --filter poker-client build && ${prepareFrontendCommand} && python3 -m http.server ${FRONTEND_PORT} --bind ${FRONTEND_BIND_HOST} --directory ../poker-client/dist`,
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      // Avoid watch mode restarts during long e2e runs.
      command: `rm -rf ${E2E_DATA_DIR} && PORT=${BACKEND_PORT} DATA_DIR=${E2E_DATA_DIR} CORS_ORIGIN=${FRONTEND_URL} CLIENT_URL=${FRONTEND_URL} TEST_MODE=true CHAT_RATE_LIMIT_COUNT=500 CHAT_RATE_LIMIT_WINDOW_MS=10000 CHAT_PAGE_SIZE=20 AUTH_PASSWORD_LOGIN_RATE_LIMIT_COUNT=1000 AUTH_PASSWORD_LOGIN_RATE_LIMIT_WINDOW_MS=1000 pnpm run start`,
      url: BACKEND_URL,
      reuseExistingServer: false,
      timeout: 60000,
      env: backendEnv,
    },
  ],
});
