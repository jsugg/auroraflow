#!/usr/bin/env node
// Scoped mutation baseline with the smallest deterministic footprint.
//
// No new test dependency (no Stryker): this applies a curated set of source
// mutations in place, runs the scoped unit specs, and records whether each
// mutant is killed (a scoped test fails) or survives (all scoped tests pass).
// Each source file is restored in a `finally`, plus a top-level safety restore.
//
// Usage:
//   node scripts/mutation-baseline.mjs            # refresh + record baseline (warning-only, exit 0)
//   node scripts/mutation-baseline.mjs --check    # fail if a killed mutant survives or becomes inapplicable
//   node scripts/mutation-baseline.mjs --check-report <report> [--baseline <report>]
//
// Run manually or on a schedule until runtime/tooling are accepted for PR gating.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const baselinePath = resolve(repoRoot, 'docs/quality/mutation-baseline.json');
const MUTATION_STATUSES = new Set(['killed', 'survived', 'inapplicable']);

const SCOPED_TESTS = {
  scoring: [
    'tests/suites/unit/framework/selfHealing/candidateScoring.spec.ts',
    'tests/suites/unit/framework/selfHealing/candidateScoring.property.spec.ts',
  ],
  config: [
    'tests/suites/unit/framework/selfHealing/config.spec.ts',
    'tests/suites/unit/framework/selfHealing/config.property.spec.ts',
  ],
  guardedValidation: [
    'tests/suites/unit/framework/selfHealing/guardedValidation.spec.ts',
    'tests/suites/unit/framework/selfHealing/guardedValidation.property.spec.ts',
  ],
  retry: [
    'tests/suites/unit/framework/helpers/retry.spec.ts',
    'tests/suites/unit/framework/helpers/retry.property.spec.ts',
  ],
  redisCas: [
    'tests/suites/unit/framework/data/redisClient.spec.ts',
    'tests/suites/unit/framework/data/redisClient.property.spec.ts',
  ],
};

// Curated calibration-critical operators. `find` must occur exactly once in the
// target file; otherwise the mutant is reported inapplicable (drift guard).
const MUTATIONS = [
  {
    id: 'scoring-reverse-priority',
    area: 'scoring',
    file: 'src/framework/selfHealing/candidateScoring.ts',
    description: 'Reverse candidate ordering (score ascending instead of descending).',
    find: 'return right.score - left.score;',
    replace: 'return left.score - right.score;',
  },
  {
    id: 'scoring-off-by-one-limit',
    area: 'scoring',
    file: 'src/framework/selfHealing/candidateScoring.ts',
    description: 'Return one more candidate than the bounded maximum.',
    find: '.sort(byCandidatePriority).slice(0, boundedMaxCandidates);',
    replace: '.sort(byCandidatePriority).slice(0, boundedMaxCandidates + 1);',
  },
  {
    id: 'config-min-confidence-upper-bound',
    area: 'config',
    file: 'src/framework/selfHealing/config.ts',
    description: 'Accept min confidence above 1 (broken upper bound).',
    find: 'if (parsedValue < 0 || parsedValue > 1) {',
    replace: 'if (parsedValue < 0 || parsedValue > 2) {',
  },
  {
    id: 'config-bounded-int-lower-bound',
    area: 'config',
    file: 'src/framework/selfHealing/config.ts',
    description: 'Accept bounded integers below 1 (broken lower bound).',
    find: 'if (parsedValue < 1) {',
    replace: 'if (parsedValue < 0) {',
  },
  {
    id: 'config-bounded-int-clamp',
    area: 'config',
    file: 'src/framework/selfHealing/config.ts',
    description: 'Stop clamping bounded integers at the hard maximum.',
    find: 'if (parsedValue > hardMaximum) {',
    replace: 'if (parsedValue > hardMaximum + 100) {',
  },
  {
    id: 'guarded-confidence-gate-strict',
    area: 'guardedValidation',
    file: 'src/framework/selfHealing/guardedValidation.ts',
    description: 'Exclude candidates exactly at the confidence gate (>= becomes >).',
    find: 'const confidenceEligible = suggestion.score >= minConfidence;',
    replace: 'const confidenceEligible = suggestion.score > minConfidence;',
  },
  {
    id: 'retry-terminal-attempt-off-by-one',
    area: 'retry',
    file: 'src/helpers/helpers.ts',
    description: 'Skip the terminal retry failure branch (off-by-one on last attempt).',
    find: 'if (attempt === retries) {',
    replace: 'if (attempt === retries + 1) {',
  },
  {
    id: 'retry-integer-lower-bound',
    area: 'retry',
    file: 'src/helpers/helpers.ts',
    description: 'Reject the minimum-valid integer option (< becomes <=).',
    find: 'if (!Number.isInteger(value) || value < min || value > max) {',
    replace: 'if (!Number.isInteger(value) || value <= min || value > max) {',
  },
  {
    id: 'cas-reply-shape-guard',
    area: 'redisCas',
    file: 'src/utils/redisClient.ts',
    description: 'Weaken the compare-and-set reply length guard (!== 2 becomes < 2).',
    find: 'if (!Array.isArray(reply) || reply.length !== 2) {',
    replace: 'if (!Array.isArray(reply) || reply.length < 2) {',
  },
  {
    id: 'cas-written-flag',
    area: 'redisCas',
    file: 'src/utils/redisClient.ts',
    description: 'Break the written-flag parse (|| becomes &&, never written).',
    find: "const written = writtenReply === 1 || writtenReply === '1';",
    replace: "const written = writtenReply === 1 && writtenReply === '1';",
  },
  {
    id: 'cas-expected-version-lower-bound',
    area: 'redisCas',
    file: 'src/utils/redisClient.ts',
    description: 'Accept a non-positive expected version (< 1 becomes < 0).',
    find: 'if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {',
    replace: 'if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {',
  },
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function runScopedTests(area) {
  const testFiles = SCOPED_TESTS[area];
  const result = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      ...testFiles,
      '--pool=threads',
      '--no-isolate',
      '--testTimeout=30000',
      '--reporter=dot',
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
  );
  // Non-zero exit => a scoped test failed => the mutant was killed.
  return result.status === 0 ? 'survived' : 'killed';
}

function getOptionValue(argv, optionName) {
  const optionIndexes = argv.flatMap((argument, index) => (argument === optionName ? [index] : []));
  if (optionIndexes.length > 1) {
    throw new Error(`${optionName} may be supplied only once.`);
  }
  const optionIndex = optionIndexes[0];
  if (optionIndex === undefined) {
    return undefined;
  }
  const value = argv[optionIndex + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a file path.`);
  }
  return value;
}

function readMutationReport(reportPath, label) {
  const absolutePath = resolve(repoRoot, reportPath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be readable valid JSON (${absolutePath}): ${detail}`);
  }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.mutations)) {
    throw new Error(`${label} must be a JSON object with a mutations array (${absolutePath}).`);
  }

  const seenIds = new Set();
  for (const [index, entry] of parsed.mutations.entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`${label} mutations[${index}] must be an object.`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`${label} mutations[${index}].id must be a non-empty string.`);
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`${label} contains duplicate mutation id: ${entry.id}.`);
    }
    seenIds.add(entry.id);
    if (typeof entry.area !== 'string' || entry.area.length === 0) {
      throw new Error(`${label} mutation ${entry.id}.area must be a non-empty string.`);
    }
    if (!MUTATION_STATUSES.has(entry.status)) {
      throw new Error(
        `${label} mutation ${entry.id}.status must be killed, survived, or inapplicable.`,
      );
    }
  }

  return parsed.mutations;
}

function findMutationRegressions(results, baselineMutations) {
  const baselineById = new Map(baselineMutations.map((entry) => [entry.id, entry]));
  return results.filter((entry) => {
    const previous = baselineById.get(entry.id);
    return previous?.status === 'killed' && entry.status !== 'killed';
  });
}

function reportMutationRegressions(regressions) {
  if (regressions.length === 0) {
    process.stdout.write('\nNo mutation regressions against the recorded baseline.\n');
    return;
  }

  process.stderr.write(
    '\nMutation regression: previously-killed mutants now survive or are inapplicable:\n',
  );
  for (const entry of regressions) {
    process.stderr.write(`  - ${entry.id} (${entry.area}): ${entry.status}\n`);
  }
  process.stderr.write(
    'Remediation: restore killing assertions or update stale mutation definitions, then review and record the baseline intentionally.\n',
  );
  process.exitCode = 1;
}

function main() {
  const cliArgs = process.argv.slice(2);
  const checkMode = cliArgs.includes('--check');
  const checkReportPath = getOptionValue(cliArgs, '--check-report');
  const selectedBaselinePath = getOptionValue(cliArgs, '--baseline') ?? baselinePath;
  if (!checkMode && checkReportPath === undefined && cliArgs.includes('--baseline')) {
    throw new Error('--baseline requires --check or --check-report.');
  }
  if (checkReportPath !== undefined) {
    const current = readMutationReport(checkReportPath, 'Current mutation report');
    const baseline = readMutationReport(selectedBaselinePath, 'Mutation baseline');
    reportMutationRegressions(findMutationRegressions(current, baseline));
    return;
  }

  const originals = new Map();
  const results = [];

  try {
    for (const mutation of MUTATIONS) {
      const absolutePath = resolve(repoRoot, mutation.file);
      if (!originals.has(absolutePath)) {
        originals.set(absolutePath, readFileSync(absolutePath, 'utf8'));
      }
      const source = originals.get(absolutePath);
      const occurrences = countOccurrences(source, mutation.find);

      if (occurrences !== 1) {
        results.push({
          id: mutation.id,
          area: mutation.area,
          file: mutation.file,
          description: mutation.description,
          status: 'inapplicable',
          detail: `expected exactly 1 match for find string, got ${occurrences}`,
        });
        process.stdout.write(`• ${mutation.id}: inapplicable (${occurrences} matches)\n`);
        continue;
      }

      const mutated = source.replace(mutation.find, mutation.replace);
      try {
        writeFileSync(absolutePath, mutated);
        const status = runScopedTests(mutation.area);
        results.push({
          id: mutation.id,
          area: mutation.area,
          file: mutation.file,
          description: mutation.description,
          status,
        });
        process.stdout.write(`${status === 'killed' ? '✓' : '✗'} ${mutation.id}: ${status}\n`);
      } finally {
        writeFileSync(absolutePath, source);
      }
    }
  } finally {
    for (const [absolutePath, source] of originals) {
      writeFileSync(absolutePath, source);
    }
  }

  results.sort((left, right) => left.id.localeCompare(right.id));
  const killed = results.filter((entry) => entry.status === 'killed').length;
  const survived = results.filter((entry) => entry.status === 'survived');
  const inapplicable = results.filter((entry) => entry.status === 'inapplicable').length;
  const scored = killed + survived.length;
  const killRate = scored === 0 ? 0 : Math.round((killed / scored) * 1000) / 1000;

  const report = {
    tool: 'auroraflow-mutation-baseline',
    schemaVersion: '1.0.0',
    summary: {
      total: results.length,
      killed,
      survived: survived.length,
      inapplicable,
      killRate,
    },
    mutations: results,
  };

  process.stdout.write(
    `\nMutation baseline: ${killed}/${scored} killed (kill rate ${killRate}), ${inapplicable} inapplicable.\n`,
  );
  if (survived.length > 0) {
    process.stdout.write('Surviving mutants (review for missing assertions):\n');
    for (const entry of survived) {
      process.stdout.write(`  - ${entry.id} (${entry.area}): ${entry.description}\n`);
    }
  }

  if (checkMode) {
    const baseline = readMutationReport(selectedBaselinePath, 'Mutation baseline');
    reportMutationRegressions(findMutationRegressions(results, baseline));
    return;
  }

  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nRecorded baseline -> ${baselinePath}\n`);
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Mutation baseline failed: ${detail}\n`);
  process.exitCode = 1;
}
