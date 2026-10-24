import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 940 }, channel: 'msedge', launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
  webServer: process.env.ROOMSHIFT_TEST_SERVER ? undefined : { command: 'node server/index.js', url: 'http://localhost:3000', timeout: 30000, reuseExistingServer: !process.env.CI, env: { NODE_ENV: 'production' } },
});
