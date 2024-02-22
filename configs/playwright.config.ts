import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium' } },
    { name: 'Firefox', use: { browserName: 'firefox' } },
    { name: 'Safari', use: { browserName: 'webkit' } },
    { name: 'Edge', use: { browserName: 'chromium', channel: 'msedge' } },
  ],
  outputDir: '../test-results',
  testDir: '../tests',
  fullyParallel: true,
  reporter: [['html', { outputFolder: '../test-reports' }]],
};

export default config;
