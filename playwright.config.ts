import { defineConfig, devices } from '@playwright/test';

// Target is parameterized so the same suite runs against dev (:3000, default),
// the local prod stack, and the live site: `BASE_URL=https://zoci.me npm run test:e2e`.
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isLocalDev = BASE_URL === 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true, // local `tls internal` / prod stack use non-public certs
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile-android', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-ios', use: { ...devices['iPhone 13'] } }, // WebKit
  ],
  // Only auto-start the dev server when targeting local dev; reuse if already running.
  webServer: isLocalDev
    ? {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});
