import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import {
  getWorkflowJob,
  getWorkflowMatrixValues,
  getWorkflowStep,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');
const releaseWorkflow = readWorkflowModel('.github/workflows/release.yml');
const lockedInstallActionPath = './.github/actions/setup-node-cache';
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  readonly engines?: { readonly node?: string };
};

describe('quality workflow Node compatibility contract', () => {
  it('runs the Node matrix for 20, 22, and 24 on runtime-sensitive behavior only', () => {
    const nodeCompatJob = getWorkflowJob(qualityWorkflow, 'node-compat');

    expect(nodeCompatJob.name).toBe('Node Compatibility (Node ${{ matrix.node-version }})');
    expect(
      getWorkflowMatrixValues(nodeCompatJob, 'node-version'),
      'Node compatibility matrix must cover supported Node floor/current/ceiling versions.',
    ).toEqual(['20', '22', '24']);
    expect(
      getWorkflowStep(nodeCompatJob, 'Run unit tests').run,
      'Node matrix must exercise runtime-sensitive unit behavior only.',
    ).toBe('npm test');
  });

  it('declares engines range compatible with Node 24', () => {
    expect(packageJson.engines?.node).toBe('>=20 <25');
  });

  it('keeps runtime-insensitive static gates out of the Node matrix', () => {
    const nodeCompatJob = getWorkflowJob(qualityWorkflow, 'node-compat');
    const stepNames = nodeCompatJob.steps.map((step) => step.name);

    for (const staticStepName of [
      'Run format check',
      'Run lint',
      'Run typecheck',
      'Run contract tests',
      'Run Redis/OTLP integration tests',
      'Validate artifact schemas',
      'Run shell and workflow lint',
      'Run full Chrome E2E suite',
    ]) {
      expectInvariant(
        !stepNames.includes(staticStepName),
        `Node compatibility matrix must not repeat runtime-insensitive gate per Node version: ${staticStepName}.`,
      );
    }
    expectInvariant(
      nodeCompatJob.steps.every(
        (step) => !step.run?.includes('lint') && !step.run?.includes('typecheck'),
      ),
      'Node matrix must not rerun lint/typecheck on every Node version.',
    );
  });

  it('runs format, lint, typecheck, contracts, integration, schema, shell, and workflow gates once on Node 22', () => {
    const staticJob = getWorkflowJob(qualityWorkflow, 'static-analysis');
    const lockedInstallStep = getWorkflowStep(staticJob, 'Setup locked Node.js dependencies');

    expect(staticJob.name).toBe('Static Analysis (Node 22)');
    expect(lockedInstallStep.uses).toBe(lockedInstallActionPath);
    expect(lockedInstallStep.with.get('node-version')).toBe('22');
    expect(lockedInstallStep.with.get('cache-namespace')).toBe('static-analysis');
    expect(getWorkflowStep(staticJob, 'Run format check').run).toBe('npm run format:check');
    expect(getWorkflowStep(staticJob, 'Run lint').run).toBe('npm run lint');
    expect(getWorkflowStep(staticJob, 'Run typecheck').run).toBe('npm run typecheck');
    expect(getWorkflowStep(staticJob, 'Run contract tests').run).toBe('npm run test:contracts');
    expect(getWorkflowStep(staticJob, 'Run Redis/OTLP integration tests').run).toBe(
      'npm run test:integration',
    );
    expect(
      getWorkflowStep(staticJob, 'Run Redis/OTLP integration tests').env.get(
        'AURORAFLOW_REDIS_INTEGRATION_REQUIRED',
      ),
    ).toBe('true');
    expect(getWorkflowStep(staticJob, 'Validate artifact schemas').run).toBe(
      'npm run schemas:check',
    );
    expect(getWorkflowStep(staticJob, 'Run shell and workflow lint').run).toBe(
      'npm run shellcheck && npm run workflows:lint:check',
    );
  });

  it('installs actionlint once and lints workflows through the non-installing command', () => {
    const staticJob = getWorkflowJob(qualityWorkflow, 'static-analysis');
    const installSteps = staticJob.steps.filter((step) => step.run === 'npm run tools:actionlint');

    expectInvariant(
      installSteps.length === 1,
      'actionlint must be installed exactly once per static-analysis job.',
    );
    const shellWorkflowStep = getWorkflowStep(staticJob, 'Run shell and workflow lint');
    expectTextIncludes(shellWorkflowStep.run ?? '', {
      text: 'workflows:lint:check',
      rationale: 'Workflow lint must reuse the installed actionlint, not reinstall it.',
    });
    expectInvariant(
      !(shellWorkflowStep.run ?? '').includes('npm run workflows:lint '),
      'Static-analysis must not invoke the reinstalling workflows:lint command.',
    );
  });

  it('enforces coverage floors in one complete unit coverage run on Node 22', () => {
    const coverageJob = getWorkflowJob(qualityWorkflow, 'coverage');
    const setupNodeStep = getWorkflowStep(coverageJob, 'Setup locked Node.js dependencies');

    expect(coverageJob.name).toBe('Coverage (Unit Floors)');
    expect(setupNodeStep.uses).toBe(lockedInstallActionPath);
    expect(setupNodeStep.with.get('node-version')).toBe('22');
    expect(setupNodeStep.with.get('cache-namespace')).toBe('coverage');
    expectTextIncludes(
      getWorkflowStep(coverageJob, 'Enforce global and risk-weighted coverage thresholds').run ??
        '',
      {
        text: 'npm run test:coverage 2>&1 | tee coverage/coverage-gate.log',
        rationale: 'Coverage gate must preserve threshold output for actionable job summaries.',
      },
    );
    const summaryStep = getWorkflowStep(coverageJob, 'Summarize coverage gate');
    expect(summaryStep.if).toBe('always()');
    expectTextIncludes(summaryStep.run ?? '', {
      text: 'GITHUB_STEP_SUMMARY',
      rationale: 'Coverage gate must publish a summary even after threshold failures.',
    });
    expectTextIncludes(summaryStep.run ?? '', {
      text: 'coverage/coverage-gate.log',
      rationale: 'Coverage summary must identify the module/floor output that failed.',
    });
  });

  it('keeps the required release verify path in Redis-required integration mode', () => {
    expect(
      getWorkflowStep(
        getWorkflowJob(releaseWorkflow, 'release-dry-run'),
        'Run quality gates',
      ).env.get('AURORAFLOW_REDIS_INTEGRATION_REQUIRED'),
    ).toBe('true');
  });

  it('consolidates smoke, guarded self-heal, examples, and risk into one event-aware Chrome lane', () => {
    const preflightJob = getWorkflowJob(qualityWorkflow, 'preflight');
    const e2eJob = getWorkflowJob(qualityWorkflow, 'e2e-chrome');
    const pathsFilterStep = getWorkflowStep(preflightJob, 'Detect change scopes');

    expect(e2eJob.name).toBe('E2E (Chrome)');
    expect(e2eJob.needs).toEqual(['preflight', 'static-analysis', 'node-compat']);
    expect(getWorkflowStep(e2eJob, 'Run full Chrome E2E suite').run).toBe(
      "npm run test:e2e -- --project='Google Chrome'",
    );
    expect(
      preflightJob.outputs.get('run_browser_e2e'),
      'Preflight must expose a browser-relevance output that gates the single Chrome lane.',
    ).toBe('${{ steps.paths-filter.outputs.browser_e2e }}');
    expectTextIncludes(pathsFilterStep.with.get('filters') ?? '', {
      text: 'browser_e2e:',
      rationale: 'Path filter must define the browser_e2e scope for the consolidated Chrome lane.',
    });

    const jobLevelGate = e2eJob.if ?? '';
    for (const text of [
      "needs.preflight.outputs.run_browser_e2e == 'true'",
      "github.ref == 'refs/heads/main'",
      "'full-e2e'",
      "'risk:e2e'",
    ]) {
      expectTextIncludes(jobLevelGate, {
        text,
        rationale: 'Chrome lane must gate on browser relevance plus main and explicit labels.',
      });
    }

    // The guarded self-heal proof and examples are folded into the full Chrome run,
    // not separate jobs that would re-execute the same Playwright test IDs.
    for (const retiredJobId of ['smoke-e2e', 'guarded-self-heal', 'risk-e2e']) {
      expectInvariant(
        !qualityWorkflow.jobs.has(retiredJobId),
        `Retired duplicate Chrome lane must not remain: ${retiredJobId}.`,
      );
    }
    expectInvariant(
      getWorkflowJob(qualityWorkflow, 'node-compat').steps.every(
        (step) => !step.run?.includes('test:e2e'),
      ),
      'Node compatibility job must not run browser-heavy E2E commands.',
    );
  });

  it('replaces runner-consuming skip steps with job-level conditions', () => {
    for (const job of qualityWorkflow.jobs.values()) {
      expectInvariant(
        job.steps.every((step) => !/completed as a no-op|no-op\.$/u.test(step.run ?? '')),
        `Job ${job.id} must skip before runner allocation, not echo a no-op skip step.`,
      );
    }
  });
});
