import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.mts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        thresholds: {
          statements: 70,
          branches: 60,
          functions: 75,
          lines: 70,
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
  }),
);
