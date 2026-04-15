import { describe, expect, it } from 'vitest';
import type { FlakinessSummary } from '../../../../../src/framework/observability/flakinessReport';
import {
  buildSloDashboard,
  buildSloDashboardMarkdown,
} from '../../../../../src/framework/observability/sloDashboard';

function createFlakinessSummary(overrides: Partial<FlakinessSummary> = {}): FlakinessSummary {
  return {
    generatedAt: '2026-04-15T12:00:00.000Z',
    status: 'complete',
    sourceFiles: 3,
    totalTests: 100,
    flakyTests: 1,
    failedTests: 1,
    passedTests: 98,
    skippedTests: 0,
    interruptedTests: 0,
    totalAttempts: 104,
    totalFailedAttempts: 4,
    projectBreakdown: [],
    topFlakyCases: [],
    testCases: [],
    ...overrides,
  };
}

describe('buildSloDashboard', () => {
  it('computes KPI statuses and overall health from flakiness plus governance telemetry', () => {
    const dashboard = buildSloDashboard({
      flakiness: createFlakinessSummary(),
      governance: {
        status: 'triage_required',
        triageRequired: true,
        guardedAcceptedCount: 2,
        telemetry: {
          guardedAutoHeal: {
            attempted: 20,
            succeeded: 19,
            failed: 1,
            skipped: 3,
          },
        },
      },
      generatedAt: new Date('2026-04-15T12:30:00.000Z'),
    });

    expect(dashboard.status).toBe('complete');
    expect(dashboard.overallStatus).toBe('healthy');
    expect(dashboard.generatedAt).toBe('2026-04-15T12:30:00.000Z');
    expect(dashboard.selfHealing.triageRequired).toBe(true);
    expect(dashboard.selfHealing.guardedAutoHealAttempts).toBe(20);
    expect(dashboard.selfHealing.guardedAutoHealFailed).toBe(1);
    expect(dashboard.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'passRate',
          status: 'met',
          value: 0.98,
        }),
        expect.objectContaining({
          key: 'flakeRate',
          status: 'met',
          value: 0.01,
        }),
        expect.objectContaining({
          key: 'guardedAutoHealFailureRate',
          status: 'met',
          value: 0.05,
        }),
      ]),
    );
  });

  it('marks breached metrics and degraded overall status when thresholds are exceeded', () => {
    const dashboard = buildSloDashboard({
      flakiness: createFlakinessSummary({
        totalTests: 20,
        passedTests: 16,
        failedTests: 3,
        flakyTests: 1,
        totalAttempts: 40,
        totalFailedAttempts: 8,
      }),
      governance: {
        telemetry: {
          guardedAutoHeal: {
            attempted: 10,
            succeeded: 8,
            failed: 2,
            skipped: 0,
          },
        },
      },
    });

    expect(dashboard.overallStatus).toBe('degraded');
    expect(dashboard.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'passRate', status: 'breached' }),
        expect.objectContaining({ key: 'failureRate', status: 'breached' }),
        expect.objectContaining({ key: 'retryFailureRate', status: 'breached' }),
        expect.objectContaining({ key: 'guardedAutoHealFailureRate', status: 'breached' }),
      ]),
    );
  });

  it('uses insufficient_data when denominator metrics are unavailable', () => {
    const dashboard = buildSloDashboard({
      flakiness: createFlakinessSummary({
        status: 'no-input',
        sourceFiles: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        flakyTests: 0,
        totalAttempts: 0,
        totalFailedAttempts: 0,
      }),
    });

    expect(dashboard.status).toBe('no-input');
    expect(dashboard.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'passRate', value: null, status: 'insufficient_data' }),
        expect.objectContaining({
          key: 'guardedAutoHealFailureRate',
          value: null,
          status: 'insufficient_data',
        }),
      ]),
    );
    expect(dashboard.overallStatus).toBe('insufficient_data');
  });
});

describe('buildSloDashboardMarkdown', () => {
  it('renders markdown sections and metric table rows', () => {
    const dashboard = buildSloDashboard({
      flakiness: createFlakinessSummary(),
    });

    const markdown = buildSloDashboardMarkdown(dashboard);
    expect(markdown).toContain('# SLO Dashboard');
    expect(markdown).toContain('## KPI Status');
    expect(markdown).toContain('| Pass Rate | 98.00% | >= 98.00% | met |');
  });
});
