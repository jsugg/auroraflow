import { describe, expect, it } from 'vitest';
import { resolveCorrelationIdentifiers } from '../../../../../src/framework/observability/correlation';

describe('resolveCorrelationIdentifiers', () => {
  it('returns local defaults when no identifiers are available', () => {
    expect(resolveCorrelationIdentifiers({ env: {} })).toEqual({
      runId: 'local-run',
      testId: undefined,
    });
  });

  it('resolves run and test identifiers from environment values', () => {
    expect(
      resolveCorrelationIdentifiers({
        env: {
          AURORAFLOW_RUN_ID: 'aurora-run',
          AURORAFLOW_TEST_ID: 'aurora-test',
        },
      }),
    ).toEqual({
      runId: 'aurora-run',
      testId: 'aurora-test',
    });
  });

  it('prioritizes explicit correlation values over environment fallbacks', () => {
    expect(
      resolveCorrelationIdentifiers({
        correlation: {
          runId: 'explicit-run',
          testId: 'explicit-test',
        },
        env: {
          AURORAFLOW_RUN_ID: 'env-run',
          AURORAFLOW_TEST_ID: 'env-test',
          GITHUB_RUN_ID: 'github-run',
          PLAYWRIGHT_TEST_ID: 'pw-test',
        },
      }),
    ).toEqual({
      runId: 'explicit-run',
      testId: 'explicit-test',
    });
  });
});
