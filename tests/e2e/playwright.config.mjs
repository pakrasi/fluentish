// Browser e2e (ARCHITECTURE §8): the stamped build (_site/) in WebKit at an iPhone's 390 px and in desktop Chromium.
//   npm run test:e2e        stamps _site/ and runs every spec in both browsers
// Service workers are blocked so the routes in fixtures.mjs answer every request; the offline spec turns the worker
// on for itself. CI runs this as the e2e job, which the deploy waits for (.github/workflows/ci.yml).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 8471);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: '../../test-results/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'webkit-390', use: { ...devices['iPhone 14'], browserName: 'webkit', viewport: { width: 390, height: 844 } } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `node tests/e2e/server.mjs ${PORT}`,
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/fluentish/version.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
