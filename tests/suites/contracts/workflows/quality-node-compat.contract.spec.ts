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
  it('includes Node 20, 22, and 24 in the Node compatibility matrix', () => {
    const verifyJob = getWorkflowJob(qualityWorkflow, 'verify');

    expect(verifyJob.name).toBe('Node Compatibility (Node ${{ matrix.node-version }})');
    expect(
      getWorkflowMatrixValues(verifyJob, 'node-version'),
      'Node compatibility matrix must cover supported Node floor/current/ceiling versions.',
    ).toEqual(['20', '22', '24']);
  });

  it('declares engines range compatible with Node 24', () => {
    expect(packageJson.engines?.node).toBe('>=20 <25');
  });

  it('keeps the Node matrix free of Docker and browser-heavy gates', () => {
    const verifyJob = getWorkflowJob(qualityWorkflow, 'verify');
    const stepNames = verifyJob.steps.map((step) => step.name);

    expect(getWorkflowStep(verifyJob, 'Run Node compatibility static gates').run).toBe(
      'npm run lint && npm run typecheck',
    );
    expect(getWorkflowStep(verifyJob, 'Run unit tests').run).toBe('npm test');
    for (const blockedStepName of [
      'Run contract tests',
      'Run Redis/OTLP integration tests',
      'Validate artifact schemas',
      'Ensure Playwright Chrome is installed',
    ]) {
      expectInvariant(
        !stepNames.includes(blockedStepName),
        `Node compatibility job must not include heavy repository/browser gate: ${blockedStepName}.`,
      );
    }
  });

  it('runs contract, Redis required-mode, schema, shell, and workflow gates once on Node 22', () => {
    const repositoryGatesJob = getWorkflowJob(qualityWorkflow, 'repository-gates');
    const stepNames = repositoryGatesJob.steps.map((step) => step.name);
    const lockedInstallStep = getWorkflowStep(
      repositoryGatesJob,
      'Setup locked Node.js dependencies',
    );

    expect(repositoryGatesJob.name).toBe('Repository Gates (Node 22)');
    expect(lockedInstallStep.uses).toBe(lockedInstallActionPath);
    expect(lockedInstallStep.with.get('node-version')).toBe('22');
    expect(lockedInstallStep.with.get('cache-namespace')).toBe('repository-gates');
    expect(getWorkflowStep(repositoryGatesJob, 'Run format check').run).toBe(
      'npm run format:check',
    );
    expect(getWorkflowStep(repositoryGatesJob, 'Run contract tests').run).toBe(
      'npm run test:contracts',
    );
    expect(getWorkflowStep(repositoryGatesJob, 'Run Redis/OTLP integration tests').run).toBe(
      'npm run test:integration',
    );
    expect(
      getWorkflowStep(repositoryGatesJob, 'Run Redis/OTLP integration tests').env.get(
        'AURORAFLOW_REDIS_INTEGRATION_REQUIRED',
      ),
    ).toBe('true');
    expect(getWorkflowStep(repositoryGatesJob, 'Validate artifact schemas').run).toBe(
      'npm run schemas:check',
    );
    expect(getWorkflowStep(repositoryGatesJob, 'Run shell and workflow lint').run).toBe(
      'npm run shellcheck && npm run workflows:lint',
    );
    expect(stepNames.indexOf('Run contract tests')).toBeLessThan(
      stepNames.indexOf('Run Redis/OTLP integration tests'),
    );
  });

  it('enforces critical and global coverage once on Node 22', () => {
    const coverageJob = getWorkflowJob(qualityWorkflow, 'coverage');
    const setupNodeStep = getWorkflowStep(coverageJob, 'Setup locked Node.js dependencies');

    expect(coverageJob.name).toBe('Coverage (Critical + Global)');
    expect(setupNodeStep.uses).toBe(lockedInstallActionPath);
    expect(setupNodeStep.with.get('node-version')).toBe('22');
    expect(setupNodeStep.with.get('cache-namespace')).toBe('coverage');
    expectTextIncludes(
      getWorkflowStep(coverageJob, 'Enforce critical and global coverage thresholds').run ?? '',
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

  it('makes Redis integration and guarded self-heal proof mandatory in quality gates', () => {
    const repositoryGatesJob = getWorkflowJob(qualityWorkflow, 'repository-gates');
    const guardedSelfHealJob = getWorkflowJob(qualityWorkflow, 'guarded-self-heal');

    expect(
      getWorkflowStep(repositoryGatesJob, 'Run Redis/OTLP integration tests').env.get(
        'AURORAFLOW_REDIS_INTEGRATION_REQUIRED',
      ),
    ).toBe('true');
    expect(
      getWorkflowStep(
        getWorkflowJob(releaseWorkflow, 'release-dry-run'),
        'Run quality gates',
      ).env.get('AURORAFLOW_REDIS_INTEGRATION_REQUIRED'),
    ).toBe('true');
    expect(guardedSelfHealJob.name).toBe('Guarded Self-Heal Proof (Chrome)');
    expect(guardedSelfHealJob.needs).toEqual(['preflight', 'verify', 'repository-gates']);
    expect(getWorkflowStep(guardedSelfHealJob, 'Prove guarded self-heal at default gate').run).toBe(
      'npm run test:e2e:guarded',
    );
  });

  it('adds path and label triggered full Chrome E2E without merging it into compatibility gates', () => {
    const preflightJob = getWorkflowJob(qualityWorkflow, 'preflight');
    const riskE2eJob = getWorkflowJob(qualityWorkflow, 'risk-e2e');
    const pathsFilterStep = getWorkflowStep(preflightJob, 'Detect smoke-relevant changes');
    const shouldRunRiskE2e = riskE2eJob.env.get('SHOULD_RUN_RISK_E2E');
    if (shouldRunRiskE2e === undefined) {
      throw new Error('risk-e2e job must declare SHOULD_RUN_RISK_E2E');
    }

    expect(
      preflightJob.outputs.get('run_risk_e2e'),
      'Preflight job must expose path-filter output that gates risk-triggered E2E.',
    ).toBe('${{ steps.paths-filter.outputs.risk_e2e }}');
    expectTextIncludes(pathsFilterStep.with.get('filters') ?? '', {
      text: 'risk_e2e:',
      rationale: 'Path filter config must include risk_e2e group for runtime/browser changes.',
    });
    expect(riskE2eJob.name).toBe('Risk-Triggered E2E (Chrome)');
    expect(riskE2eJob.needs).toEqual(['preflight', 'verify', 'repository-gates']);
    for (const text of [
      "needs.preflight.outputs.run_risk_e2e == 'true'",
      "'full-e2e'",
      "'risk:e2e'",
    ]) {
      expectTextIncludes(shouldRunRiskE2e, {
        text,
        rationale: 'Risk E2E gate must respect paths plus explicit maintainer labels.',
      });
    }
    const riskSetupStep = getWorkflowStep(
      riskE2eJob,
      'Setup locked Node.js dependencies and Playwright browser',
    );
    expect(riskSetupStep.uses).toBe(lockedInstallActionPath);
    expect(riskSetupStep.with.get('install-browsers')).toBe('true');
    expect(riskSetupStep.with.get('browser-name')).toBe('chrome');
    expect(riskSetupStep.with.get('cache-namespace')).toBe('risk-chrome');
    expect(getWorkflowStep(riskE2eJob, 'Run full Chrome E2E suite').run).toBe(
      "npm run test:e2e -- --project='Google Chrome'",
    );
    expectInvariant(
      getWorkflowJob(qualityWorkflow, 'verify').steps.every(
        (step) => !step.run?.includes('test:e2e'),
      ),
      'Node compatibility job must not run browser-heavy E2E commands.',
    );
  });
});
