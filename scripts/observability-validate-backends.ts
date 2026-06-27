import process from 'node:process';
import {
  parseObservabilityBackendValidationCliOptions,
  runObservabilityBackendValidation,
} from '../src/framework/observability/backendValidation';

async function main(): Promise<number> {
  const options = parseObservabilityBackendValidationCliOptions(process.argv.slice(2));
  const result = await runObservabilityBackendValidation(options);
  const summary = `mode=${result.mode} passed=${result.summary.passed} failed=${result.summary.failed}`;

  if (result.status === 'failed') {
    console.error(`Observability backend validation failed: ${summary}`);
    for (const check of result.checks.filter((candidate) => candidate.status === 'failed')) {
      console.error(`${check.checkId}: ${check.message}`);
    }
    return 1;
  }

  console.log(`Observability backend validation passed: ${summary}`);
  return 0;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to validate observability backends: ${message}`);
    process.exit(1);
  });
