import { defineConfig, devices } from '@playwright/test';
import { DEV_SERVER_TAG, MOBILE_GREP, MOBILE_ONLY_SPECS } from './e2e-projects';

// Demo writes live in the server process, so every worker gets its own server and port.
// E2E_SERVER=built serves the built dist/ instead of the dev server (scripts/e2e-servers.ts).
const WORKERS = Number(process.env.E2E_WORKERS ?? (process.env.CI ? 4 : 2));
// E2E_PORT_BASE lets runs in separate checkouts on one machine use their own ports.
const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 4323);
const BUILT = process.env.E2E_SERVER === 'built';

export default defineConfig({
  testDir: './tests',
  workers: WORKERS,
  // Against the built site each test starts with fresh demo data (tests/fixtures.ts), so the tests
  // of one file spread across the workers. On the dev server the tests of a file share the data
  // of their server and run one after the other.
  fullyParallel: BUILT,
  forbidOnly: !!process.env.CI,
  // Tests that load source modules of the dev server have nothing to load from the built site
  grepInvert: BUILT ? new RegExp(DEV_SERVER_TAG) : undefined,
  // One retry in CI, so a timing flake of the runner does not fail an unrelated PR; the report
  // still lists the test as flaky. Locally a failure shows at once.
  retries: process.env.CI ? 1 : 0,
  // CI adds the JSON report (PLAYWRIGHT_JSON_OUTPUT_FILE) for the list of failed and flaky tests
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/report' }],
    ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : []),
  ],
  outputDir: 'test-results/artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: MOBILE_ONLY_SPECS,
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
      grep: MOBILE_GREP,
      use: {
        ...devices['Pixel 7'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    {
      name: 'webkit-tablet',
      testMatch: ['**/theme.spec.ts', '**/aufgaben-alignment.spec.ts', '**/staff-menu.spec.ts'],
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
