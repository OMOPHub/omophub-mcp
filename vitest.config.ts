import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/client/types.ts'],
      // Vitest 4's @vitest/coverage-v8 measures statements ~1.5pp lower than
      // v3 for the same code (the v8 provider was rewritten to fix branch
      // attribution and async-boundary inaccuracies). 90% restores headroom
      // above the new measurement floor. The largest single gap is
      // `src/transports/http.ts` (~61%); cover that and we can lift this
      // back to 93%+.
      thresholds: { statements: 90 },
    },
  },
});
