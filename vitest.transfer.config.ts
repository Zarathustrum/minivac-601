import { defineConfig } from 'vitest/config';

// The transfer test (test/pane/transfer.dotnet.ts) builds and runs the C# pane engine, so it
// needs the .NET SDK. It is kept out of the default include (vite.config.ts) and runs on its own
// with `npm run transfer`, as `npm run parity` does for the C# core.
export default defineConfig({
  test: {
    include: ['test/pane/transfer.dotnet.ts'],
  },
});
