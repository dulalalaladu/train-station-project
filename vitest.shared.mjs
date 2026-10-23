// Shared Vitest settings; each package's vitest.config.ts spreads this in.
// The 80% coverage gate is mandatory (plan §4.5, §9.4) and enforced from day one.
export default {
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
};
