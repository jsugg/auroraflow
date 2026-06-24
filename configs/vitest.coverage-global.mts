import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.mts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        // The `auroraflow/playwright` entrypoint (src/playwright.ts) is a thin
        // Playwright Test fixture wiring (`base.extend`) with no node-reachable
        // logic. Its lifecycle is proven by the browser-free withAuroraFlowFixture
        // unit tests and exercised in real Playwright runs, so it is excluded from
        // node coverage like the browser-only DOM snapshot path (AUR-IMPL-023).
        exclude: ['src/playwright.ts'],
        thresholds: {
          // Global aggregate floor: erosion guard only. Risk lives in the
          // per-file floors below, not in this aggregate (AUR-QE-109 / TQE-005).
          statements: 78,
          branches: 68,
          functions: 85,
          lines: 78,
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
          // AUR-IMPL-020 structured candidate model: locator resolution and the
          // legacy string read path are correctness-critical, so they carry a
          // floor below measured coverage to guard against erosion.
          'src/framework/selfHealing/candidateLocator.ts': {
            statements: 90,
            branches: 85,
            functions: 95,
            lines: 90,
          },
          'src/framework/selfHealing/historyRepository.ts': {
            statements: 75,
            branches: 75,
            functions: 85,
            lines: 75,
          },
          // AUR-QE-109 risk-weighted floors for high-risk library surfaces that
          // a global aggregate would otherwise hide. Floors sit below measured
          // coverage so a failure means real erosion, not noise.
          'src/framework/observability/otelTelemetry.ts': {
            statements: 95,
            branches: 90,
            functions: 95,
            lines: 95,
          },
          'src/data/selectors/redisSelectorStore.ts': {
            statements: 95,
            branches: 90,
            functions: 95,
            lines: 95,
          },
          'src/utils/redisClient.ts': {
            statements: 75,
            branches: 68,
            functions: 78,
            lines: 75,
          },
          'src/framework/selfHealing/promotionWorkflow.ts': {
            statements: 68,
            branches: 48,
            functions: 75,
            lines: 68,
          },
          // Documented coverage exemption (AUR-QE-109 step 4 / TQE-005).
          // ~90% of domSnapshot.ts executes inside `page.evaluate` (browser
          // context), which node coverage cannot reach; that path is proven by
          // the E2E guarded Chrome proof (test:e2e:guarded). The node-reachable
          // privacy/normalization helpers and the capture wrapper are unit-tested
          // in domSnapshot.spec.ts (~84% of the node-reachable surface). These
          // floors guard that surface from erosion; the line/statement ceiling is
          // structural, not a coverage gap.
          // Exemption expiry: revisit when AUR-IMPL-020 structured candidates move
          // the browser logic into node-testable units.
          'src/framework/selfHealing/domSnapshot.ts': {
            statements: 9,
            branches: 9,
            functions: 18,
            lines: 9,
          },
        },
      },
    },
  }),
);
