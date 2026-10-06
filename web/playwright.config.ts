import { defineConfig, devices } from '@playwright/test';

// Demo writes live in the dev server process, so every worker gets its own server and port.
const WORKERS = Number(process.env.E2E_WORKERS ?? (process.env.CI ? 4 : 2));

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
      testMatch: '**/theme.spec.ts',
      use: { ...devices['iPad Pro 11'] },
    },
  ],
  webServer: Array.from({ length: WORKERS }, (_, index) => {
    const port = 4323 + index;
    return {
      command: `bun run dev:mock --host 127.0.0.1 --port ${port} --ignore-lock`,
      url: `http://127.0.0.1:${port}/api/gruppenstunden`,
      env: { VITE_CACHE_SUFFIX: String(port) },
      reuseExistingServer: false,
      timeout: 60_000,
    };
  }),
});
