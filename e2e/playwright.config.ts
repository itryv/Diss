import { defineConfig, devices } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A fresh SQLite database per test run. Computed once at config-load time so
 * both the server webServer entry and any helpers agree on the path.
 */
const tempDb = path.join(
  os.tmpdir(),
  `diss-e2e-${process.pid}-${Date.now()}.db`,
);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Meeting tests drive real WebRTC through one LiveKit dev server — keep
  // workers low so rooms/ports don't fight each other.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      cwd: path.resolve(dirname, '../server'),
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: '8787',
        DATABASE_PATH: tempDb,
        SESSION_SECRET: 'e2e-test-secret',
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_URL: 'http://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'secret',
        CORS_ORIGIN: 'http://localhost:5173',
      },
    },
    {
      command: 'npm run dev',
      cwd: path.resolve(dirname, '../app'),
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
