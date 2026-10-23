import { defineConfig } from 'vitest/config';

import shared from '../../vitest.shared.mjs';

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    coverage: {
      ...shared.test.coverage,
      // cli.ts is argument plumbing around startEchoServer (exercised by hand and in the test plan).
      exclude: ['src/cli.ts'],
    },
  },
});
