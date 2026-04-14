import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type SelfHealingArtifactAnalysis = {
  artifactsDir: string;
  totalArtifacts: number;
  parsedArtifacts: number;
  malformedArtifacts: Array<{ fileName: string; error: string }>;
  guardedArtifacts: number;
  telemetry: {
    modes: Record<string, number>;
    actions: Record<string, number>;
    errorCodes: Record<string, number>;
    guardedAutoHeal: {
      attempted: number;
      succeeded: number;
      failed: number;
      skipped: number;
    };
  };
  guardedAccepted: Array<{
    eventId: string;
    pageObjectName: string;
    acceptedLocator?: string;
    acceptedScore?: number;
    currentUrl?: string;
  }>;
};

type GovernanceModule = {
  analyzeSelfHealingArtifacts: (artifactsDir?: string) => Promise<SelfHealingArtifactAnalysis>;
  buildGovernanceSummary: (input: {
    analysis: SelfHealingArtifactAnalysis;
    requireAcknowledgement: boolean;
    acknowledged: boolean;
    generatedAt?: Date;
  }) => {
    summary: {
      status: string;
      triageRequired: boolean;
      generatedAt: string;
    };
    markdown: string;
  };
  runSelfHealingGovernance: (options?: {
    artifactsDir?: string;
    requireAcknowledgement?: boolean;
    acknowledged?: boolean;
    summaryJsonPath?: string;
    summaryMarkdownPath?: string;
  }) => Promise<number>;
};

let governanceModuleCache: GovernanceModule | null = null;

async function loadGovernanceModule(): Promise<GovernanceModule> {
  if (governanceModuleCache) {
    return governanceModuleCache;
  }

  const scriptPath = path.join(process.cwd(), 'scripts/self-healing-governance.mjs');
  const loadedModule = (await import(pathToFileURL(scriptPath).href)) as GovernanceModule;
  governanceModuleCache = loadedModule;
  return loadedModule;
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

describe('self-healing governance script', () => {
  const tempDirectories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...tempDirectories].map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
    tempDirectories.clear();
  });

  it('returns an empty analysis when the artifacts directory does not exist', async () => {
    const governance = await loadGovernanceModule();
    const missingDir = path.join(os.tmpdir(), `missing-self-heal-${Date.now()}`);
    const analysis = await governance.analyzeSelfHealingArtifacts(missingDir);

    expect(analysis.totalArtifacts).toBe(0);
    expect(analysis.parsedArtifacts).toBe(0);
    expect(analysis.guardedAccepted).toEqual([]);
    expect(analysis.malformedArtifacts).toEqual([]);
  });

  it('blocks when guarded accepted candidates exist without acknowledgement', async () => {
    const governance = await loadGovernanceModule();
    const tempDir = await createTempDir('self-heal-governance-');
    tempDirectories.add(tempDir);

    const artifactsDir = path.join(tempDir, 'artifacts');
    const summaryJsonPath = path.join(tempDir, 'summary.json');
    const summaryMarkdownPath = path.join(tempDir, 'summary.md');

    await writeJsonFile(path.join(artifactsDir, 'event-001.json'), {
      eventId: 'evt-001',
      mode: 'guarded',
      pageObjectName: 'ExamplePage',
      action: {
        type: 'click',
      },
      errorCode: 'page_action_click_failed',
      guardedAutoHeal: {
        attempted: true,
        succeeded: true,
      },
      currentUrl: 'https://example.test/page',
      guardedValidation: {
        acceptedLocator: "page.getByRole('button', { name: /submit/i })",
        acceptedScore: 0.93,
      },
    });

    const exitCode = await governance.runSelfHealingGovernance({
      artifactsDir,
      requireAcknowledgement: true,
      acknowledged: false,
      summaryJsonPath,
      summaryMarkdownPath,
    });

    expect(exitCode).toBe(1);

    const summary = JSON.parse(await readFile(summaryJsonPath, 'utf8')) as {
      status: string;
      telemetry: {
        actions: Record<string, number>;
        errorCodes: Record<string, number>;
        guardedAutoHeal: {
          attempted: number;
          succeeded: number;
          failed: number;
          skipped: number;
        };
      };
    };
    expect(summary.status).toBe('blocked_acknowledgement_required');
    expect(summary.telemetry.actions.click).toBe(1);
    expect(summary.telemetry.errorCodes.page_action_click_failed).toBe(1);
    expect(summary.telemetry.guardedAutoHeal).toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('passes when guarded accepted candidates are explicitly acknowledged', async () => {
    const governance = await loadGovernanceModule();
    const tempDir = await createTempDir('self-heal-governance-');
    tempDirectories.add(tempDir);

    const artifactsDir = path.join(tempDir, 'artifacts');
    const summaryJsonPath = path.join(tempDir, 'summary.json');
    const summaryMarkdownPath = path.join(tempDir, 'summary.md');

    await writeJsonFile(path.join(artifactsDir, 'event-001.json'), {
      eventId: 'evt-001',
      mode: 'guarded',
      pageObjectName: 'ExamplePage',
      guardedValidation: {
        acceptedLocator: "page.getByRole('button', { name: /submit/i })",
        acceptedScore: 0.94,
      },
    });

    const exitCode = await governance.runSelfHealingGovernance({
      artifactsDir,
      requireAcknowledgement: true,
      acknowledged: true,
      summaryJsonPath,
      summaryMarkdownPath,
    });

    expect(exitCode).toBe(0);

    const summary = JSON.parse(await readFile(summaryJsonPath, 'utf8')) as { status: string };
    expect(summary.status).toBe('triage_required');

    const markdown = await readFile(summaryMarkdownPath, 'utf8');
    expect(markdown).toContain('Guarded Accepted Events');
    expect(markdown).toContain('evt-001');
  });

  it('blocks when malformed artifacts are detected', async () => {
    const governance = await loadGovernanceModule();
    const tempDir = await createTempDir('self-heal-governance-');
    tempDirectories.add(tempDir);

    const artifactsDir = path.join(tempDir, 'artifacts');
    const summaryJsonPath = path.join(tempDir, 'summary.json');
    const summaryMarkdownPath = path.join(tempDir, 'summary.md');

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(path.join(artifactsDir, 'bad.json'), '{not-valid-json', 'utf8');

    const exitCode = await governance.runSelfHealingGovernance({
      artifactsDir,
      requireAcknowledgement: true,
      acknowledged: true,
      summaryJsonPath,
      summaryMarkdownPath,
    });

    expect(exitCode).toBe(1);

    const summary = JSON.parse(await readFile(summaryJsonPath, 'utf8')) as {
      status: string;
      malformedArtifacts: Array<{ fileName: string }>;
    };
    expect(summary.status).toBe('blocked_malformed_artifacts');
    expect(summary.malformedArtifacts).toEqual([expect.objectContaining({ fileName: 'bad.json' })]);
  });

  it('generates pass summary when no guarded acceptance exists', async () => {
    const governance = await loadGovernanceModule();
    const analysis = {
      artifactsDir: 'test-results/self-healing',
      totalArtifacts: 1,
      parsedArtifacts: 1,
      malformedArtifacts: [],
      guardedArtifacts: 1,
      telemetry: {
        modes: { guarded: 1 },
        actions: { click: 1 },
        errorCodes: { page_action_click_failed: 1 },
        guardedAutoHeal: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          skipped: 0,
        },
      },
      guardedAccepted: [],
    };

    const { summary } = governance.buildGovernanceSummary({
      analysis,
      requireAcknowledgement: true,
      acknowledged: false,
      generatedAt: new Date('2026-04-14T00:00:00.000Z'),
    });

    expect(summary.status).toBe('pass');
    expect(summary.triageRequired).toBe(false);
    expect(summary.generatedAt).toBe('2026-04-14T00:00:00.000Z');
    expect(summary).toMatchObject({
      telemetry: {
        modes: { guarded: 1 },
        actions: { click: 1 },
        errorCodes: { page_action_click_failed: 1 },
      },
    });
  });
});
