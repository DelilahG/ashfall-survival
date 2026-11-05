import { defineConfig } from '@playwright/test';

// On Windows the preinstalled Microsoft Edge is used so no browser download is
// needed. Elsewhere, run `npx playwright install chromium` once, or set
// PW_CHANNEL=chrome to use an installed Chrome.
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel,
    trace: 'off',
  },
  projects: [{ name: 'desktop', use: { channel, viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
