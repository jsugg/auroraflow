import { describe, expect, it, vi } from 'vitest';
import {
  RESOURCE_ATTRIBUTE_NAMES,
  TelemetryConfigError,
  resolveTelemetryConfig,
} from '../../../../../src/framework/observability/telemetryConfig';
import { createNoopTelemetry } from '../../../../../src/framework/observability/noopTelemetry';
import {
  initializeTelemetry,
  resetTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';

describe('resolveTelemetryConfig', () => {
  it('keeps the artifact-only tier disabled by default with local resource attributes', () => {
    const config = resolveTelemetryConfig({});

    expect(config.enabled).toBe(false);
    expect(config.strict).toBe(false);
    expect(config.serviceName).toBe('auroraflow');
    expect(config.serviceVersion).toBe('1.0.0');
    expect(config.environment).toBe('local');
    expect(config.exportRawSelectors).toBe(false);
    expect(config.resourceAttributes).toMatchObject({
      'service.name': 'auroraflow',
      'service.version': '1.0.0',
      'deployment.environment': 'local',
      'auroraflow.run_id': 'local-run',
    });
  });

  it('normalizes CI, VCS, run, project, and OTEL resource attributes', () => {
    const config = resolveTelemetryConfig({
      AURORAFLOW_OBSERVABILITY_ENABLED: 'true',
      AURORAFLOW_OBSERVABILITY_ENVIRONMENT: 'ci',
      AURORAFLOW_OBSERVABILITY_SERVICE_NAME: 'auroraflow-ci',
      AURORAFLOW_RUN_ID: 'run-42',
      AURORAFLOW_TEST_ID: 'spec-7',
      AURORAFLOW_PROJECT: 'Google Chrome',
      AURORAFLOW_SHARD: '1/2',
      GITHUB_REPOSITORY: 'jsugg/auroraflow',
      GITHUB_REF_NAME: 'feature/observability-stack',
      GITHUB_SHA: 'abc123',
      GITHUB_WORKFLOW: 'Quality Gates',
      GITHUB_JOB: 'verify',
      GITHUB_RUN_ID: 'github-run-1',
      OTEL_RESOURCE_ATTRIBUTES: 'custom.attribute=value',
    });

    expect(config.enabled).toBe(true);
    expect(config.resourceAttributes).toMatchObject({
      'service.name': 'auroraflow-ci',
      'deployment.environment': 'ci',
      'custom.attribute': 'value',
      'vcs.repository.url': 'https://github.com/jsugg/auroraflow',
      'vcs.branch': 'feature/observability-stack',
      'vcs.commit.sha': 'abc123',
      'ci.workflow.name': 'Quality Gates',
      'ci.job.name': 'verify',
      'ci.run.id': 'github-run-1',
      'auroraflow.run_id': 'run-42',
      'auroraflow.test_id': 'spec-7',
      'auroraflow.project': 'Google Chrome',
      'auroraflow.shard': '1/2',
    });
  });

  it('rejects invalid boolean, environment, and OTLP endpoint values', () => {
    expect(() => resolveTelemetryConfig({ AURORAFLOW_OBSERVABILITY_ENABLED: 'sometimes' })).toThrow(
      TelemetryConfigError,
    );

    expect(() => resolveTelemetryConfig({ AURORAFLOW_OBSERVABILITY_ENVIRONMENT: 'qa' })).toThrow(
      TelemetryConfigError,
    );

    expect(() =>
      resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://collector:4318' }),
    ).toThrow(TelemetryConfigError);
  });

  it('documents every required resource attribute name in the exported contract list', () => {
    expect(RESOURCE_ATTRIBUTE_NAMES).toContain('service.name');
    expect(RESOURCE_ATTRIBUTE_NAMES).toContain('deployment.environment');
    expect(RESOURCE_ATTRIBUTE_NAMES).toContain('auroraflow.run_id');
  });
});

describe('NoopTelemetry', () => {
  it('executes wrapped tasks without recording telemetry side effects', async () => {
    const telemetry = createNoopTelemetry(resolveTelemetryConfig({}));
    const task = vi.fn(async () => 'ok');

    await expect(
      telemetry.runSpan({
        name: 'auroraflow.page_action',
        task,
      }),
    ).resolves.toBe('ok');

    expect(telemetry.isEnabled()).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);
    expect(telemetry.getLogCorrelation()).toEqual({});
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe('initializeTelemetry', () => {
  it('returns no-op telemetry for the default artifact-only tier', () => {
    const telemetry = initializeTelemetry({ env: {} });

    expect(telemetry.isEnabled()).toBe(false);
    resetTelemetryForTests();
  });
});
