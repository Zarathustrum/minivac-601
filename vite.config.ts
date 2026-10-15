import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Broad enough that a spec placed outside test/ still runs instead of
    // being silently skipped. Playwright specs use *.browser.ts, so they
    // are not picked up here.
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts', 'tools/**/*.spec.ts'],
  },
});
