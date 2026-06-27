import { cpus, platform, release, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import {
  FAILURE_PATH_FIXTURE_COMPONENTS,
  buildFailurePathFixtureHtml,
} from '../benchmarks/fixtures/failurePathFixture';
import { MemorySelectorStore } from '../src/data/selectors/memorySelectorStore';
import { SelectorRegistryRepository } from '../src/data/selectors/selectorRegistry';
import { METRIC_NAMES, type MetricName } from '../src/framework/observability/metricNames';
import { NoopTelemetry } from '../src/framework/observability/noopTelemetry';
import type { TelemetryAttributes } from '../src/framework/observability/telemetry';
import { resolveTelemetryConfig } from '../src/framework/observability/telemetryConfig';
import { createAuroraFlowContext } from '../src/framework/runtime/auroraFlowContext';
import { rankSelfHealingCandidates } from '../src/framework/selfHealing/candidateScoring';
import { resolveSelfHealingConfig } from '../src/framework/selfHealing/config';
import { extractDomCandidateSeeds } from '../src/framework/selfHealing/domCandidateExtraction';
import { captureDomSnapshot, summarizeDomSnapshot } from '../src/framework/selfHealing/domSnapshot';
import { createFileFailureArtifactWriter } from '../src/framework/selfHealing/failureCapture';
import { createStoreSelfHealingRegistryRuntime } from '../src/framework/selfHealing/registryRuntime';
import { generateRankedLocatorSuggestions } from '../src/framework/selfHealing/suggestionEngine';
import type {
  CapturedFailureEvent,
  DomSnapshot,
  RankedSelfHealingCandidate,
} from '../src/framework/selfHealing/types';
import { PageActionError, PageObjectBase } from '../src/pageObjects/pageObjectBase';
import type { Logger } from '../src/utils/logger';
import {
  FAILURE_PATH_BASELINE_PATH,
  MAX_BENCHMARK_ITERATIONS,
  formatWarningOnlyRegressionReport,
  parseFailurePathBenchmarkResults,
  parseFailurePathBenchmarkOptions,
  summarizeDurations,
  type FailurePathBenchmarkResults,
  type FailurePathBenchmarkOptions,
} from './failure-path-benchmark-lib';

const MAX_DOM_NODES = 500;
const MAX_TEXT_LENGTH = 120;
const MAX_SAT_CANDIDATES = 12;
const BENCHMARK_SELECTOR_ID = 'benchmark.failure.disabled';
const BENCHMARK_PAGE_OBJECT = 'FailurePathBenchmarkPage';
const FIXED_CAPTURED_AT = '2026-06-26T00:00:00.000Z';

interface CapturedHistogram {
  readonly attributes?: TelemetryAttributes;
  readonly name: MetricName;
  readonly value: number;
}

interface FailurePathBenchmarkReport {
  readonly benchmark: 'auroraflow-failure-path';
  readonly environment: {
    readonly architecture: string;
    readonly browserVersion: string;
    readonly cpuModel: string;
    readonly logicalCpuCount: number;
    readonly nodeVersion: string;
    readonly operatingSystem: string;
    readonly operatingSystemRelease: string;
    readonly totalMemoryBytes: number;
  };
  readonly fixture: {
    readonly componentCount: number;
    readonly maxDomNodes: number;
    readonly maxTextLength: number;
    readonly registry: 'memory';
    readonly screenshotCapture: true;
    readonly satCandidateCount: number;
    readonly artifactBytes: number;
  };
  readonly generatedAt: string;
  readonly policy: {
    readonly approvalStatus: 'pending';
    readonly enforcement: 'warning_only';
    readonly hardThresholds: null;
  };
  readonly results: FailurePathBenchmarkResults;
  readonly run: {
    readonly iterations: number;
    readonly warmupIterations: number;
  };
  readonly schemaVersion: 2;
}

interface BenchmarkSample {
  readonly aggregateFailurePathDurationMs: number;
  readonly artifactBytes: number;
  readonly artifactWriteDurationMs: number;
  readonly domSnapshotDurationMs: number;
  readonly satCandidateCount: number;
  readonly satCandidateExtractionDurationMs: number;
}

const benchmarkLogger: Logger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

class BenchmarkTelemetry extends NoopTelemetry {
  public readonly histograms: CapturedHistogram[] = [];

  public constructor() {
    super(resolveTelemetryConfig({ AURORAFLOW_OBSERVABILITY_ENABLED: 'false' }));
  }

  public override recordHistogram(
    name: MetricName,
    value: number,
    attributes?: TelemetryAttributes,
  ): void {
    this.histograms.push({ name, value, attributes });
  }
}

class FailurePathBenchmarkPage extends PageObjectBase {
  public constructor(page: Page, artifactRoot: string, telemetry: BenchmarkTelemetry) {
    const store = new MemorySelectorStore();
    const runtime = createStoreSelfHealingRegistryRuntime({
      store,
      namespace: 'auroraflow:benchmark:selectors',
    });
    super(
      page,
      BENCHMARK_PAGE_OBJECT,
      createAuroraFlowContext({
        artifactRoot,
        correlation: { runId: 'failure-path-benchmark', testId: 'deterministic-fixture' },
        createLogger: () => benchmarkLogger,
        resolveRegistryRuntime: () => runtime,
        selfHealingConfig: resolveSelfHealingConfig({
          SELF_HEAL_ALLOWED_ACTIONS: 'click',
          SELF_HEAL_MAX_CANDIDATES: '12',
          SELF_HEAL_MAX_DOM_NODES: String(MAX_DOM_NODES),
          SELF_HEAL_MAX_TEXT_LENGTH: String(MAX_TEXT_LENGTH),
          SELF_HEAL_MIN_CONFIDENCE: '0.92',
          SELF_HEAL_MODE: 'guarded',
          SELF_HEAL_REGISTRY_MODE: 'write_pending',
          SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS: String(MAX_BENCHMARK_ITERATIONS * 4),
          SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS: String(MAX_BENCHMARK_ITERATIONS * 4),
          SELF_HEAL_RUN_BUDGET_MODE: 'warning_only',
          SELF_HEAL_SAT_CAPTURE_DOM: 'true',
          SELF_HEAL_SAT_ENABLED: 'true',
        }),
        telemetry,
      }),
    );
    this.store = store;
  }

  private readonly store: MemorySelectorStore;

  public async seedRegistry(): Promise<void> {
    const repository = new SelectorRegistryRepository({
      store: this.store,
      namespace: 'auroraflow:benchmark:selectors',
      now: () => new Date('2026-06-26T00:00:00.000Z'),
    });
    await repository.upsert({
      actionType: 'click',
      confidence: 0.99,
      id: BENCHMARK_SELECTOR_ID,
      locator: "page.getByTestId('benchmark-disabled')",
      pageObjectName: BENCHMARK_PAGE_OBJECT,
      strategy: 'registry',
    });
  }

  public async dispose(): Promise<void> {
    await this.store.close();
  }
}

async function measureDomSnapshot(
  page: Page,
): Promise<{ readonly durationMs: number; readonly snapshot: DomSnapshot }> {
  const startedAt = performance.now();
  const snapshot = await captureDomSnapshot(page, {
    allowedAttributes: ['data-testid', 'id', 'name', 'role', 'aria-label', 'type'],
    capturedAt: FIXED_CAPTURED_AT,
    currentUrl: 'about:blank',
    maxDomNodes: MAX_DOM_NODES,
    maxTextLength: MAX_TEXT_LENGTH,
  });
  const durationMs = performance.now() - startedAt;
  if (snapshot.nodeCount !== MAX_DOM_NODES || !snapshot.truncated) {
    throw new Error(
      `Deterministic DOM fixture drifted: expected ${MAX_DOM_NODES} scanned nodes and truncation.`,
    );
  }
  return { durationMs, snapshot };
}

function measureSatCandidateExtraction(snapshot: DomSnapshot): {
  readonly candidates: ReturnType<typeof extractDomCandidateSeeds>;
  readonly durationMs: number;
} {
  const startedAt = performance.now();
  const candidates = extractDomCandidateSeeds({
    snapshot,
    actionType: 'click',
    maxTextLength: MAX_TEXT_LENGTH,
  });
  const durationMs = performance.now() - startedAt;
  if (candidates.length === 0) {
    throw new Error('Deterministic DOM fixture produced no SAT candidates.');
  }
  return { candidates, durationMs };
}

function buildBenchmarkArtifact(
  eventId: string,
  snapshot: DomSnapshot,
  candidates: readonly RankedSelfHealingCandidate[],
): CapturedFailureEvent {
  const suggestions = generateRankedLocatorSuggestions({
    actionType: 'click',
    failedTarget: 'css=[',
  });
  return {
    artifactVersion: '1.0.0',
    eventId,
    timestamp: FIXED_CAPTURED_AT,
    runId: 'failure-path-benchmark',
    testId: 'deterministic-fixture',
    component: BENCHMARK_PAGE_OBJECT,
    errorCode: 'page_action_click_failed',
    mode: 'guarded',
    minConfidence: 0.92,
    safetyPolicy: { allowedActions: ['click'], allowedDomains: [] },
    pageObjectName: BENCHMARK_PAGE_OBJECT,
    currentUrl: 'about:blank',
    screenshotPath: 'failure-path-benchmark.png',
    action: {
      type: 'click',
      target: 'css=[',
      selectorId: BENCHMARK_SELECTOR_ID,
      description: 'Deterministic benchmark failure',
    },
    error: {
      name: 'Error',
      message: 'Deterministic benchmark failure',
    },
    suggestions,
    sat: {
      schemaVersion: '1.0.0',
      enabled: true,
      snapshot: summarizeDomSnapshot(snapshot),
      candidates,
      history: { enabled: true, observations: 0, loadedCandidates: 0, warnings: [] },
      selectedCandidateId: candidates[0]?.id,
      analysisWarnings: [],
    },
  };
}

async function measureArtifactWrite(
  artifactRoot: string,
  event: CapturedFailureEvent,
): Promise<{ readonly bytes: number; readonly durationMs: number }> {
  const outputDirectory = path.join(artifactRoot, 'isolated-artifact-write');
  const writer = createFileFailureArtifactWriter(outputDirectory);
  const startedAt = performance.now();
  await writer(event);
  const durationMs = performance.now() - startedAt;
  const fileStats = await stat(path.join(outputDirectory, `${event.eventId}.json`));
  if (fileStats.size < 1) {
    throw new Error('Deterministic failure artifact was empty.');
  }
  return { bytes: fileStats.size, durationMs };
}

async function measureAggregateFailurePath(page: Page, artifactRoot: string): Promise<number> {
  const telemetry = new BenchmarkTelemetry();
  const pageObject = new FailurePathBenchmarkPage(page, artifactRoot, telemetry);
  await pageObject.seedRegistry();

  try {
    await pageObject.click('css=[', { selectorId: BENCHMARK_SELECTOR_ID, timeout: 1 });
    throw new Error('Deterministic failure action unexpectedly succeeded.');
  } catch (error: unknown) {
    if (!(error instanceof PageActionError)) {
      throw error;
    }
  } finally {
    await pageObject.dispose();
  }

  const metric = telemetry.histograms.find(
    (histogram) => histogram.name === METRIC_NAMES.selfHealingFailurePathDurationMs,
  );
  if (metric === undefined) {
    throw new Error('Aggregate failure-path duration metric was not emitted.');
  }
  return metric.value;
}

async function measureBenchmarkSample(
  page: Page,
  artifactRoot: string,
  sampleIndex: number,
): Promise<BenchmarkSample> {
  const { durationMs: domSnapshotDurationMs, snapshot } = await measureDomSnapshot(page);
  const { candidates: extractedCandidates, durationMs: satCandidateExtractionDurationMs } =
    measureSatCandidateExtraction(snapshot);
  const suggestions = generateRankedLocatorSuggestions({
    actionType: 'click',
    failedTarget: 'css=[',
  });
  const rankedCandidates = rankSelfHealingCandidates({
    pageObjectName: BENCHMARK_PAGE_OBJECT,
    actionType: 'click',
    failedTarget: 'css=[',
    selectorId: BENCHMARK_SELECTOR_ID,
    heuristicSuggestions: suggestions,
    domCandidates: extractedCandidates,
    maxCandidates: MAX_SAT_CANDIDATES,
  });
  const eventId = `benchmark-artifact-${sampleIndex.toString().padStart(3, '0')}`;
  const artifact = buildBenchmarkArtifact(eventId, snapshot, rankedCandidates);
  const { bytes: artifactBytes, durationMs: artifactWriteDurationMs } = await measureArtifactWrite(
    artifactRoot,
    artifact,
  );

  return {
    aggregateFailurePathDurationMs: await measureAggregateFailurePath(page, artifactRoot),
    artifactBytes,
    artifactWriteDurationMs,
    domSnapshotDurationMs,
    satCandidateCount: extractedCandidates.length,
    satCandidateExtractionDurationMs,
  };
}

async function launchBenchmarkBrowser(): Promise<Browser> {
  const channel = process.env.AURORAFLOW_BENCHMARK_BROWSER_CHANNEL?.trim() || 'chrome';
  return channel === 'chromium'
    ? chromium.launch({ headless: true })
    : chromium.launch({ channel, headless: true });
}

async function runBenchmark(
  options: FailurePathBenchmarkOptions,
): Promise<FailurePathBenchmarkReport> {
  const artifactRoot = await mkdtemp(path.join(process.cwd(), '.failure-path-benchmark-'));
  let browser: Browser | undefined;
  try {
    browser = await launchBenchmarkBrowser();
    const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
    await page.setContent(buildFailurePathFixtureHtml(), { waitUntil: 'load' });

    const samples: BenchmarkSample[] = [];
    let expectedArtifactBytes: number | undefined;
    let expectedSatCandidateCount: number | undefined;
    const totalIterations = options.warmupIterations + options.iterations;
    for (let index = 0; index < totalIterations; index += 1) {
      const sample = await measureBenchmarkSample(page, artifactRoot, index);
      expectedArtifactBytes ??= sample.artifactBytes;
      expectedSatCandidateCount ??= sample.satCandidateCount;
      if (
        sample.artifactBytes !== expectedArtifactBytes ||
        sample.satCandidateCount !== expectedSatCandidateCount
      ) {
        throw new Error('Deterministic failure fixture output drifted between benchmark samples.');
      }
      if (index >= options.warmupIterations) {
        samples.push(sample);
      }
    }
    if (expectedArtifactBytes === undefined || expectedSatCandidateCount === undefined) {
      throw new Error('Failure-path benchmark did not produce a fixture profile.');
    }

    const cpuInfo = cpus();
    return {
      benchmark: 'auroraflow-failure-path',
      environment: {
        architecture: process.arch,
        browserVersion: browser.version(),
        cpuModel: cpuInfo[0]?.model ?? 'unknown',
        logicalCpuCount: cpuInfo.length,
        nodeVersion: process.version,
        operatingSystem: platform(),
        operatingSystemRelease: release(),
        totalMemoryBytes: totalmem(),
      },
      fixture: {
        componentCount: FAILURE_PATH_FIXTURE_COMPONENTS,
        maxDomNodes: MAX_DOM_NODES,
        maxTextLength: MAX_TEXT_LENGTH,
        registry: 'memory',
        screenshotCapture: true,
        satCandidateCount: expectedSatCandidateCount,
        artifactBytes: expectedArtifactBytes,
      },
      generatedAt: new Date().toISOString(),
      policy: {
        approvalStatus: 'pending',
        enforcement: 'warning_only',
        hardThresholds: null,
      },
      results: {
        aggregateFailurePathDurationMs: summarizeDurations(
          samples.map((sample) => sample.aggregateFailurePathDurationMs),
        ),
        domSnapshotDurationMs: summarizeDurations(
          samples.map((sample) => sample.domSnapshotDurationMs),
        ),
        satCandidateExtractionDurationMs: summarizeDurations(
          samples.map((sample) => sample.satCandidateExtractionDurationMs),
        ),
        artifactWriteDurationMs: summarizeDurations(
          samples.map((sample) => sample.artifactWriteDurationMs),
        ),
      },
      run: {
        iterations: options.iterations,
        warmupIterations: options.warmupIterations,
      },
      schemaVersion: 2,
    };
  } finally {
    await browser?.close();
    await rm(artifactRoot, { force: true, recursive: true });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readCommittedBaselineResults(): Promise<FailurePathBenchmarkResults> {
  const baselinePath = path.resolve(FAILURE_PATH_BASELINE_PATH);
  const parsed: unknown = JSON.parse(await readFile(baselinePath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`${baselinePath} must contain a JSON object.`);
  }
  return parseFailurePathBenchmarkResults(parsed.results);
}

async function main(): Promise<void> {
  const options = parseFailurePathBenchmarkOptions(process.argv.slice(2));
  const report = await runBenchmark(options);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report.results, null, 2)}\n`);
  process.stdout.write(`Failure-path benchmark report: ${options.outputPath}\n`);
  if (!options.recordBaseline) {
    const baselineResults = await readCommittedBaselineResults();
    process.stderr.write(formatWarningOnlyRegressionReport(report.results, baselineResults));
  }
  process.stderr.write(
    'WARNING: Performance baseline is informational and warning-only; no hard threshold is enforced.\n',
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Failure-path benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
