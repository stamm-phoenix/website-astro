import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Demo writes live in one server process. Keep tests and viewport projects serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: 'http://127.0.0.1:4323',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Nix and other systems may supply their own Chromium. CI uses the pinned download.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 960 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'bun run dev:mock --host 127.0.0.1 --port 4323 --ignore-lock',
    url: 'http://127.0.0.1:4323/api/gruppenstunden',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
