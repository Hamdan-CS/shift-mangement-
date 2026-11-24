import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (PLAN.md Phase 9). They run against their own dev server
 * in demo mode (VITE_DEMO_AUTH=1, port 5175), so they never touch the real
 * database. Run: npm run test:e2e
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
    timezoneId: 'Europe/Warsaw',
  },
  webServer: {
    command: 'npx vite --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_DEMO_AUTH: '1' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile.spec.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
