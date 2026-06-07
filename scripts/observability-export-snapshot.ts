import process from 'node:process';
import {
  collectObservabilitySnapshot,
  parseObservabilitySnapshotCliOptions,
} from '../src/framework/observability/backendSnapshot';

async function main(): Promise<number> {
  const options = parseObservabilitySnapshotCliOptions(process.argv.slice(2));
  const result = await collectObservabilitySnapshot(options);
  console.log(
    `Observability snapshot written: outputDir=${result.outputDir} succeeded=${result.succeeded} failed=${result.failed}`,
  );
  return result.failed === 0 || options.allowPartial ? 0 : 1;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to export observability snapshot: ${message}`);
    process.exit(1);
  });
