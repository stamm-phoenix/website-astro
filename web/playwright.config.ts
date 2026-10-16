import { defineConfig, devices } from '@playwright/test';

// Demo writes live in the dev server process, so every worker gets its own server and port.
const WORKERS = Number(process.env.E2E_WORKERS ?? (process.env.CI ? 4 : 2));
// E2E_PORT_BASE lets runs in separate checkouts on one machine use their own ports.
const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 4323);

export default defineConfig({
  testDir: './tests',
  // Tests in one file share demo state, so files (not tests) are spread across workers.
  workers: WORKERS,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 960 },
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    {
      name: 'webkit-tablet',
      testMatch: ['**/theme.spec.ts', '**/aufgaben-alignment.spec.ts'],
      use: { ...devices['iPad Pro 11'] },
    },
  ],
  // One server per worker, all started at once by the script (Playwright would start the
  // entries of an array one after the other)
  webServer: {
    command: `bun scripts/e2e-servers.ts ${PORT_BASE} ${WORKERS}`,
    wait: { stdout: /E2E servers ready/ },
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
