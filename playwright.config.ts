import { defineConfig } from '@playwright/test';

const viewports = [
  { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { name: 'tablet-768x1024', viewport: { width: 768, height: 1024 } },
  { name: 'mobile-390x844', viewport: { width: 390, height: 844 } },
] as const;

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.browser.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: viewports.map(({ name, viewport }) => ({
    name,
    use: { viewport },
  })),
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
