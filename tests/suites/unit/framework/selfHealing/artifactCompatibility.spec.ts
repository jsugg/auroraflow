import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_FILES,
  ArtifactSchemaValidationError,
  createArtifactSchemaValidator,
  type ArtifactSchemaFile,
} from '../../../../../scripts/schemas-check';
import {
  parseCapturedFailureEvent,
  parseDomSnapshot,
  parsePendingSelectorPromotion,
  parseSelectorCandidateHistory,
} from '../../../../../src/framework/selfHealing/artifactSchema';
import {
  ObservabilityTrendPersistenceError,
  parseObservabilityTrendPoint,
  readObservabilityTrendPoints,
} from '../../../../../src/framework/observability/trends';
import { parseSelectorRecord } from '../../../../../src/data/selectors/selectorRegistry';
import { readArtifactFixture } from '../../../../helpers/artifactFixtures';

const validatorPromise = createArtifactSchemaValidator();
const temporaryDirectories: string[] = [];

const V1_SCHEMA_FIXTURES = [
  [ARTIFACT_SCHEMA_FILES.domSnapshot, 'v1/dom-snapshot.json'],
  [ARTIFACT_SCHEMA_FILES.flakinessSummary, 'v1/flakiness-summary.json'],
  [ARTIFACT_SCHEMA_FILES.observabilityTrendPoint, 'v1/observability-trend-point.json'],
  [ARTIFACT_SCHEMA_FILES.pendingSelectorPromotion, 'v1/pending-selector-promotion.json'],
  [ARTIFACT_SCHEMA_FILES.selectorCandidateHistory, 'v1/selector-candidate-history.json'],
  [ARTIFACT_SCHEMA_FILES.selectorRegistryRecord, 'v1/selector-registry-record.json'],
  [ARTIFACT_SCHEMA_FILES.selfHealingFailureEvent, 'v1/self-healing-failure-event.json'],
  [ARTIFACT_SCHEMA_FILES.selfHealingGovernanceSummary, 'v1/self-healing-governance-summary.json'],
  [ARTIFACT_SCHEMA_FILES.sloAlertEvaluation, 'v1/slo-alert-evaluation.json'],
  [ARTIFACT_SCHEMA_FILES.sloDashboard, 'v1/slo-dashboard.json'],
] as const satisfies ReadonlyArray<readonly [ArtifactSchemaFile, string]>;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('artifact compatibility fixtures', () => {
  it.each(V1_SCHEMA_FIXTURES)('must read %s fixture', async (schemaFile, fixturePath) => {
    const validator = await validatorPromise;
    validator.validate(schemaFile, await readArtifactFixture(fixturePath), fixturePath);
  });

  it('must read v1 fixtures through runtime parsers', async () => {
    expect(parseDomSnapshot(await readArtifactFixture('v1/dom-snapshot.json')).schemaVersion).toBe(
      '1.0.0',
    );
    expect(
      parseCapturedFailureEvent(await readArtifactFixture('v1/self-healing-failure-event.json'))
        .artifactVersion,
    ).toBe('1.0.0');
    expect(
      parsePendingSelectorPromotion(await readArtifactFixture('v1/pending-selector-promotion.json'))
        .promotionId,
    ).toBe('promotion:event-v1:candidate-v1');
    expect(
      parseSelectorCandidateHistory(await readArtifactFixture('v1/selector-candidate-history.json'))
        .candidateId,
    ).toBe('candidate-v1');
    expect(
      parseSelectorRecord(
        await readArtifactFixture('v1/selector-registry-record.json'),
        'v1/selector-registry-record.json',
      ),
    ).toMatchObject({ compatibility: 'current', record: { schemaVersion: '1.0.0' } });
    expect(
      parseObservabilityTrendPoint(await readArtifactFixture('v1/observability-trend-point.json'))
        .schemaVersion,
    ).toBe('1.0.0');
  });

  it('skips unknown future trend versions with a warning in tolerant streams', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'auroraflow-artifact-compat-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'trends.jsonl');
    const current = await readArtifactFixture('v1/observability-trend-point.json');
    const future = await readArtifactFixture('future/observability-trend-point.json');
    await writeFile(filePath, `${JSON.stringify(current)}\n${JSON.stringify(future)}\n`, 'utf8');
    const warnings: Array<{ filePath: string; line: number; message: string }> = [];

    const points = await readObservabilityTrendPoints(filePath, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(points).toHaveLength(1);
    expect(points[0]?.runId).toBe('run-v1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ filePath, line: 2 });
    expect(warnings[0]?.message).toContain('schemaVersion must be 1.0.0');
  });

  it('hard rejects unknown future versions at strict parser and schema boundaries', async () => {
    const futureFailure = await readArtifactFixture('future/self-healing-failure-event.json');
    const futureTrend = await readArtifactFixture('future/observability-trend-point.json');
    const validator = await validatorPromise;

    expect(() => parseCapturedFailureEvent(futureFailure)).toThrow(
      'event.artifactVersion must be 1.0.0',
    );
    expect(() => parseObservabilityTrendPoint(futureTrend)).toThrow(
      ObservabilityTrendPersistenceError,
    );
    const validateFutureFailure = (): void =>
      validator.validate(
        ARTIFACT_SCHEMA_FILES.selfHealingFailureEvent,
        futureFailure,
        'future/self-healing-failure-event.json',
      );
    expect(validateFutureFailure).toThrow(ArtifactSchemaValidationError);
    expect(validateFutureFailure).toThrow('/artifactVersion');
  });
});
