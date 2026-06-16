import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');
const releaseWorkflow = readWorkflowModel('.github/workflows/release.yml');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  readonly engines?: { readonly node?: string };
};

describe('quality workflow Node compatibility contract', () => {
  it('includes Node 20, 22, and 24 in the verify matrix', () => {
    const verifyJob = getWorkflowJob(qualityWorkflow, 'verify');

    expect(verifyJob.raw).toMatch(/node-version:\s*\[20,\s*22,\s*24\]/);
  });

  it('declares engines range compatible with Node 24', () => {
    expect(packageJson.engines?.node).toBe('>=20 <25');
  });

  it('splits unit, contract, integration, schema, and shell/workflow gates in CI logs', () => {
    const verifyJob = getWorkflowJob(qualityWorkflow, 'verify');
    const stepNames = verifyJob.steps.map((step) => step.name);

    expect(getWorkflowStep(verifyJob, 'Run static quality gates').run).toBe(
      'npm run format:check && npm run lint && npm run typecheck',
    );
    expect(getWorkflowStep(verifyJob, 'Run unit tests').run).toBe('npm test');
    expect(getWorkflowStep(verifyJob, 'Run contract tests').run).toBe('npm run test:contracts');
    expect(getWorkflowStep(verifyJob, 'Run Redis/OTLP integration tests').run).toBe(
      'npm run test:integration',
    );
    expect(
      getWorkflowStep(verifyJob, 'Run Redis/OTLP integration tests').env.get(
        'AURORAFLOW_REDIS_INTEGRATION_REQUIRED',
      ),
    ).toBe('true');
    expect(getWorkflowStep(verifyJob, 'Validate artifact schemas').run).toBe(
      'npm run schemas:check',
    );
    expect(getWorkflowStep(verifyJob, 'Run shell and workflow lint').run).toBe(
      'npm run shellcheck && npm run workflows:lint',
    );
    expect(stepNames.indexOf('Run contract tests')).toBeLessThan(
      stepNames.indexOf('Run Redis/OTLP integration tests'),
    );
  });

  it('enforces critical and global coverage once on Node 22', () => {
    const coverageJob = getWorkflowJob(qualityWorkflow, 'coverage');
    const setupNodeStep = getWorkflowStep(coverageJob, 'Setup Node.js');

    expect(coverageJob.name).toBe('Coverage (Critical + Global)');
    expect(setupNodeStep.with.get('node-version')).toBe('22');
    expect(
      getWorkflowStep(coverageJob, 'Enforce critical and global coverage thresholds').run,
    ).toBe('npm run test:coverage');
  });

  it('makes Redis integration and guarded self-heal proof mandatory in quality gates', () => {
    const guardedSelfHealJob = getWorkflowJob(qualityWorkflow, 'guarded-self-heal');

    expect(
      getWorkflowStep(
        getWorkflowJob(qualityWorkflow, 'verify'),
        'Run Redis/OTLP integration tests',
      ).env.get('AURORAFLOW_REDIS_INTEGRATION_REQUIRED'),
    ).toBe('true');
    expect(
      getWorkflowStep(
        getWorkflowJob(releaseWorkflow, 'release-dry-run'),
        'Run quality gates',
      ).env.get('AURORAFLOW_REDIS_INTEGRATION_REQUIRED'),
    ).toBe('true');
    expect(guardedSelfHealJob.name).toBe('Guarded Self-Heal Proof (Chrome)');
    expect(getWorkflowStep(guardedSelfHealJob, 'Prove guarded self-heal at default gate').run).toBe(
      'npm run test:e2e:guarded',
    );
  });
});
