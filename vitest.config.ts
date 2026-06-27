import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Stage 0: there is intentionally no real code or tests yet, so an empty
    // run must succeed rather than error on "no test files found".
    passWithNoTests: true,
  },
});
