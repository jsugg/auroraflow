import { PlaywrightTestConfig, devices } from '@playwright/test';

const reporters: NonNullable<PlaywrightTestConfig['reporter']> = [
  ['html', { outputFolder: '../test-reports' }],
];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
  reporters.push(['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
}

const config: PlaywrightTestConfig = {
  retries: process.env.CI ? 1 : 0,
  use: {
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
};

export default config;
