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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/framework/observability/trends.ts',
        'src/framework/selfHealing/artifactPrivacy.ts',
        'src/framework/selfHealing/config.ts',
        'src/framework/selfHealing/guardedValidation.ts',
        'src/framework/selfHealing/historyRepository.ts',
      ],
      thresholds: {
        'src/framework/observability/trends.ts': {
          statements: 80,
          branches: 65,
          functions: 90,
          lines: 80,
        },
        'src/framework/selfHealing/artifactPrivacy.ts': {
          statements: 85,
          branches: 80,
          functions: 95,
          lines: 85,
        },
        'src/framework/selfHealing/config.ts': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/framework/selfHealing/guardedValidation.ts': {
          statements: 85,
          branches: 75,
          functions: 90,
          lines: 85,
        },
        'src/framework/selfHealing/historyRepository.ts': {
          statements: 75,
          branches: 75,
          functions: 85,
          lines: 75,
        },
      },
    },
  },
});
