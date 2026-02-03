import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
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
  ],

  // Start both frontend and backend before tests
  webServer: [
    {
      command: 'cd ../poker-client && npm run dev',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'TEST_MODE=true npm run start:dev',
      url: 'http://localhost:3001',
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        TEST_MODE: 'true',
      },
    },
  ],
});
