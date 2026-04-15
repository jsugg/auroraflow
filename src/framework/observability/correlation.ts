export interface CorrelationIdentifiers {
  runId: string;
  testId?: string;
}

export interface CorrelationInput {
  runId?: string;
  testId?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function normalizeOptionalIdentifier(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const normalized = rawValue.trim();
  return normalized === '' ? undefined : normalized;
}

export function resolveRunId({
  runId,
  env,
}: {
  runId: string | undefined;
  env: Environment;
}): string {
  return (
    normalizeOptionalIdentifier(runId) ??
    normalizeOptionalIdentifier(env.AURORAFLOW_RUN_ID) ??
    normalizeOptionalIdentifier(env.GITHUB_RUN_ID) ??
    'local-run'
  );
}

export function resolveTestId({
  testId,
  env,
}: {
  testId: string | undefined;
  env: Environment;
}): string | undefined {
  return (
    normalizeOptionalIdentifier(testId) ??
    normalizeOptionalIdentifier(env.AURORAFLOW_TEST_ID) ??
    normalizeOptionalIdentifier(env.PLAYWRIGHT_TEST_ID)
  );
}

export function resolveCorrelationIdentifiers({
  correlation,
  env = process.env,
}: {
  correlation?: CorrelationInput;
  env?: Environment;
}): CorrelationIdentifiers {
  return {
    runId: resolveRunId({
      runId: correlation?.runId,
      env,
    }),
    testId: resolveTestId({
      testId: correlation?.testId,
      env,
    }),
  };
}
