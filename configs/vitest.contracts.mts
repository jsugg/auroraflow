import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.mts';

// Contract tests are pure and stateless (they read files and assert on parsed
// workflow/compose models), so they don't need per-file process isolation.
// Sharing a single transform/resolve pipeline avoids paying the cold
// externalize-deps (FFI) cost once per worker, cutting wall time ~2.9x.
// NOTE: keep integration tests on the default forks+isolate pool — they use
// testcontainers/redis and genuinely need process isolation.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // NOTE: do not override `include` here — vitest's mergeConfig concatenates
      // arrays, which would append to the base include and pull in other suites.
      // The `test:contracts` script passes the contracts path as a positional
      // filter instead, which unambiguously scopes the run.
      pool: 'threads',
      isolate: false,
    },
  }),
);
