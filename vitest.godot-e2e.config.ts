import { defineConfig } from 'vitest/config';

// The Godot build's chat end to end (test/pane/godot-e2e.godot.ts) builds and launches the Godot
// project, so it needs the .NET SDK and the Godot binary. It is kept out of the default include
// (vite.config.ts) and runs on its own with `npm run godot-pane-e2e`, as `npm run transfer` does.
export default defineConfig({
  test: {
    include: ['test/pane/godot-e2e.godot.ts'],
  },
});
