import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 180_000, workers: 1, reporter: [['list']],
  use: {
    baseURL: 'https://diss.remilekun.dev', ...devices['Desktop Chrome'],
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
});
