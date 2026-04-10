import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/suites/unit/**/*.spec.ts',
      'tests/suites/integration/**/*.spec.ts',
      'tests/suites/contracts/**/*.spec.ts',
      'tests/suites/framework/**/*.spec.ts',
    ],
    passWithNoTests: true,
    clearMocks: true,
  },
});
