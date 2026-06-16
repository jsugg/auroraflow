import { PlaywrightTestConfig, devices } from '@playwright/test';

const reporters: NonNullable<PlaywrightTestConfig['reporter']> = [
  ['html', { outputFolder: '../test-reports' }],
];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
  reporters.push(['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
}
const fixturePort = process.env.AURORAFLOW_E2E_FIXTURE_PORT ?? '4173';
const baseURL = process.env.AURORAFLOW_E2E_BASE_URL ?? `http://127.0.0.1:${fixturePort}`;

const config: PlaywrightTestConfig = {
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'Firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Safari',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Galaxy S9+'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  outputDir: '../test-results',
  testDir: '../tests/suites/e2e',
  fullyParallel: true,
  reporter: reporters,
  webServer: process.env.AURORAFLOW_E2E_BASE_URL
    ? undefined
    : {
        command: `node scripts/e2e-fixture-server.mjs`,
        // Run from the repo root: Playwright defaults webServer cwd to the
        // config's directory (configs/), which would resolve the script path
        // as configs/scripts/... and fail to start.
        cwd: process.cwd(),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
};

export default config;
