import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
  reporter: 'html',
  
  use: {
    trace: 'on-first-retry',
    proxy: undefined, // Disable proxy
  },

  projects: [
    {
      name: 'e2e-tests',
      use: { 
        ...devices['Desktop Chrome'],
      },
      testMatch: '**/*.spec.ts',
    },
  ],

  // Note: Start the server manually with TEST_MODE=true before running tests
  // Command: TEST_MODE=true npm run start:dev
});
