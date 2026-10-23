import { defineConfig } from 'vitest/config';

import shared from '../../vitest.shared.mjs';

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    coverage: {
      ...shared.test.coverage,
      // Runtime glue that needs the WeChat environment; covered by the developer-tool run and the
      // real-device procedure in docs/test-plans/miniprogram-audio-spike.md.
      exclude: [
        'src/pages/**',
        'src/app.ts',
        'src/env.ts',
        'src/globals.d.ts',
        'src/spike/wx-adapters.ts',
        'src/spike/ports.ts',
      ],
    },
  },
});
