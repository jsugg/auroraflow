import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_FILES,
  ArtifactSchemaValidationError,
  createArtifactSchemaValidator,
  type ArtifactSchemaFile,
} from '../../../../../scripts/schemas-check';
import {
  buildFlakinessSummary,
  type FlakinessTestCase,
} from '../../../../../src/framework/observability/flakinessReport';
import {
  buildSloDashboard,
  type SelfHealingGovernanceSummary,
} from '../../../../../src/framework/observability/sloDashboard';
import {
  evaluateAlertPolicy,
  parseAlertPolicy,
} from '../../../../../src/framework/observability/alertPolicies';

const validatorPromise = createArtifactSchemaValidator();

async function expectSchemaValid(schemaFile: ArtifactSchemaFile, payload: unknown): Promise<void> {
  const validator = await validatorPromise;
  validator.validate(schemaFile, payload);
}

function createTestCases(): FlakinessTestCase[] {
  return [
    {
      caseId: 'tests/suites/e2e/auth/login.spec.ts:10:3:Google Chrome',
      projectName: 'Google Chrome',
      file: 'tests/suites/e2e/auth/login.spec.ts',
      line: 10,
      column: 3,
      titlePath: ['auth', 'login succeeds'],
      fullTitle: 'auth > login succeeds',
      attempts: 2,
      retriesUsed: 1,
      failedAttempts: 1,
      durationMs: 35,
      finalStatus: 'passed',
      flaky: true,
    },
    {
      caseId: 'tests/suites/e2e/auth/logout.spec.ts:20:5:Google Chrome',
      projectName: 'Google Chrome',
      file: 'tests/suites/e2e/auth/logout.spec.ts',
      line: 20,
      column: 5,
      titlePath: ['auth', 'logout succeeds'],
      fullTitle: 'auth > logout succeeds',
      attempts: 1,
      retriesUsed: 0,
      failedAttempts: 0,
      durationMs: 5,
      finalStatus: 'passed',
      flaky: false,
    },
  ];
}

function createGovernanceSummary(): SelfHealingGovernanceSummary {
  return {
    status: 'triage_required',
    triageRequired: true,
    guardedAcceptedCount: 1,
    pendingPromotionCount: 1,
    registryPersistenceFailureCount: 0,
    telemetry: {
      guardedAutoHeal: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      pendingPromotionWrites: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
    },
  };
}

function createGovernanceArtifact(): Record<string, unknown> {
  return {
    ...createGovernanceSummary(),
    generatedAt: '2026-06-05T12:10:00.000Z',
    requireAcknowledgement: true,
    acknowledged: false,
    artifactsDir: 'test-results/self-healing',
    totalArtifacts: 1,
    parsedArtifacts: 1,
    malformedArtifacts: [],
    guardedArtifacts: 1,
    pendingPromotionCount: 1,
    pendingPromotions: [
      {
        fileName: 'self-heal-2026-06-05T12-00-00-000Z-abc.json',
        eventId: 'self-heal-2026-06-05T12-00-00-000Z-abc',
        mode: 'guarded',
        pageObjectName: 'CheckoutPage',
        pendingPromotionId: 'promotion:self-heal-2026-06-05:candidate',
        pendingPromotionCandidateId: 'candidate',
        pendingPromotionSelectorId: 'checkout.submit',
      },
    ],
    registryPersistenceFailureCount: 0,
    registryPersistenceFailures: [],
    guardedAccepted: [
      {
        fileName: 'self-heal-2026-06-05T12-00-00-000Z-abc.json',
        eventId: 'self-heal-2026-06-05T12-00-00-000Z-abc',
        mode: 'guarded',
        pageObjectName: 'CheckoutPage',
        currentUrl: 'https://example.test/checkout',
        actionType: 'click',
        errorCode: 'page_action_error',
        guardedAutoHealAttempted: true,
        guardedAutoHealSucceeded: true,
        acceptedLocator: 'getByRole("button", { name: "Submit order" })',
        acceptedScore: 0.94,
      },
    ],
    telemetry: {
      modes: {
        guarded: 1,
      },
      actions: {
        click: 1,
      },
      errorCodes: {
        page_action_error: 1,
      },
      guardedAutoHeal: createGovernanceSummary().telemetry?.guardedAutoHeal,
      pendingPromotionWrites: createGovernanceSummary().telemetry?.pendingPromotionWrites,
    },
  };
}

describe('observability artifact JSON Schemas', () => {
  it('validates generated flakiness summaries', async () => {
    const summary = buildFlakinessSummary({
      sourceFiles: 1,
      cases: createTestCases(),
      generatedAt: new Date('2026-06-05T12:00:00.000Z'),
    });

    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.flakinessSummary, summary);
  });

  it('validates generated SLO dashboards and alert evaluations', async () => {
    const flakiness = buildFlakinessSummary({
      sourceFiles: 1,
      cases: createTestCases(),
      generatedAt: new Date('2026-06-05T12:00:00.000Z'),
    });
    const dashboard = buildSloDashboard({
      flakiness,
      governance: createGovernanceSummary(),
      generatedAt: new Date('2026-06-05T12:15:00.000Z'),
    });
    const policy = parseAlertPolicy({
      version: '1.0.0',
      alerts: [
        {
          id: 'pass-rate-low',
          metric: 'passRate',
          operator: 'lt',
          threshold: 0.98,
          severity: 'warning',
          description: 'Pass rate below SLO.',
        },
      ],
    });
    const alertEvaluation = evaluateAlertPolicy({
      dashboard,
      policy,
      generatedAt: new Date('2026-06-05T12:20:00.000Z'),
    });

    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.sloDashboard, dashboard);
    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.sloAlertEvaluation, alertEvaluation);
  });

  it('validates current self-healing governance summaries', async () => {
    await expectSchemaValid(
      ARTIFACT_SCHEMA_FILES.selfHealingGovernanceSummary,
      createGovernanceArtifact(),
    );
  });

  it('rejects malformed generated reports with actionable diagnostics', async () => {
    const validator = await validatorPromise;

    expect(() =>
      validator.validate(ARTIFACT_SCHEMA_FILES.flakinessSummary, {
        generatedAt: '2026-06-05T12:00:00.000Z',
        status: 'complete',
        sourceFiles: 1,
        totalTests: 1,
        flakyTests: 0,
        failedTests: 0,
        passedTests: 1,
        skippedTests: 0,
        interruptedTests: 0,
        totalAttempts: 1,
        totalFailedAttempts: 0,
        projectBreakdown: [],
        topFlakyCases: [],
        testCases: [
          {
            caseId: 'case',
            projectName: 'Google Chrome',
            file: 'test.spec.ts',
            line: 1,
            column: 1,
            titlePath: ['test'],
            fullTitle: 'test',
            attempts: -1,
            retriesUsed: 0,
            failedAttempts: 0,
            durationMs: 1,
            finalStatus: 'passed',
            flaky: false,
          },
        ],
      }),
    ).toThrow(ArtifactSchemaValidationError);
    expect(() =>
      validator.validate(ARTIFACT_SCHEMA_FILES.flakinessSummary, {
        generatedAt: '2026-06-05T12:00:00.000Z',
        status: 'complete',
        sourceFiles: 1,
        totalTests: 1,
        flakyTests: 0,
        failedTests: 0,
        passedTests: 1,
        skippedTests: 0,
        interruptedTests: 0,
        totalAttempts: 1,
        totalFailedAttempts: 0,
        projectBreakdown: [],
        topFlakyCases: [],
        testCases: [
          {
            caseId: 'case',
            projectName: 'Google Chrome',
            file: 'test.spec.ts',
            line: 1,
            column: 1,
            titlePath: ['test'],
            fullTitle: 'test',
            attempts: -1,
            retriesUsed: 0,
            failedAttempts: 0,
            durationMs: 1,
            finalStatus: 'passed',
            flaky: false,
          },
        ],
      }),
    ).toThrow('/testCases/0/attempts');
  });
});
