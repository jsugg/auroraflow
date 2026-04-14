import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ARTIFACTS_DIR = path.join('test-results', 'self-healing');
const DEFAULT_SUMMARY_JSON_PATH = path.join('test-results', 'self-healing-governance-summary.json');
const DEFAULT_SUMMARY_MD_PATH = path.join('test-results', 'self-healing-governance-summary.md');

function parseBooleanFlag(rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue.trim() === '') {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function incrementCounter(counter, key) {
  if (!key || typeof key !== 'string') {
    return;
  }
  counter[key] = (counter[key] ?? 0) + 1;
}

function normalizeEventRecord(rawEvent, fileName) {
  if (typeof rawEvent !== 'object' || rawEvent === null) {
    throw new Error('Artifact root must be an object.');
  }

  const event = /** @type {Record<string, unknown>} */ (rawEvent);
  const guardedValidation =
    typeof event.guardedValidation === 'object' && event.guardedValidation !== null
      ? /** @type {Record<string, unknown>} */ (event.guardedValidation)
      : null;

  const acceptedLocator =
    guardedValidation && typeof guardedValidation.acceptedLocator === 'string'
      ? guardedValidation.acceptedLocator
      : undefined;
  const acceptedScore =
    guardedValidation && typeof guardedValidation.acceptedScore === 'number'
      ? guardedValidation.acceptedScore
      : undefined;
  const action =
    typeof event.action === 'object' && event.action !== null
      ? /** @type {Record<string, unknown>} */ (event.action)
      : null;
  const actionType = action && typeof action.type === 'string' ? action.type : undefined;
  const errorCode = typeof event.errorCode === 'string' ? event.errorCode : undefined;
  const guardedAutoHeal =
    typeof event.guardedAutoHeal === 'object' && event.guardedAutoHeal !== null
      ? /** @type {Record<string, unknown>} */ (event.guardedAutoHeal)
      : null;
  const guardedAutoHealAttempted =
    guardedAutoHeal && typeof guardedAutoHeal.attempted === 'boolean'
      ? guardedAutoHeal.attempted
      : undefined;
  const guardedAutoHealSucceeded =
    guardedAutoHeal && typeof guardedAutoHeal.succeeded === 'boolean'
      ? guardedAutoHeal.succeeded
      : undefined;

  return {
    fileName,
    eventId: typeof event.eventId === 'string' ? event.eventId : fileName,
    mode: typeof event.mode === 'string' ? event.mode : 'unknown',
    pageObjectName:
      typeof event.pageObjectName === 'string' ? event.pageObjectName : 'UnknownPageObject',
    currentUrl: typeof event.currentUrl === 'string' ? event.currentUrl : undefined,
    actionType,
    errorCode,
    guardedAutoHealAttempted,
    guardedAutoHealSucceeded,
    acceptedLocator,
    acceptedScore,
  };
}

export async function analyzeSelfHealingArtifacts(artifactsDir = DEFAULT_ARTIFACTS_DIR) {
  const analysis = {
    artifactsDir,
    totalArtifacts: 0,
    parsedArtifacts: 0,
    malformedArtifacts: [],
    guardedArtifacts: 0,
    guardedAccepted: [],
    telemetry: {
      modes: {},
      actions: {},
      errorCodes: {},
      guardedAutoHeal: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    },
  };

  try {
    await access(artifactsDir);
  } catch {
    return analysis;
  }

  const entries = await readdir(artifactsDir, { withFileTypes: true });
  const artifactFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  analysis.totalArtifacts = artifactFiles.length;

  for (const fileName of artifactFiles) {
    const artifactPath = path.join(artifactsDir, fileName);
    try {
      const content = await readFile(artifactPath, 'utf8');
      const parsed = JSON.parse(content);
      const normalized = normalizeEventRecord(parsed, fileName);
      analysis.parsedArtifacts += 1;
      incrementCounter(analysis.telemetry.modes, normalized.mode);
      incrementCounter(analysis.telemetry.actions, normalized.actionType);
      incrementCounter(analysis.telemetry.errorCodes, normalized.errorCode);

      if (normalized.guardedAutoHealAttempted === true) {
        analysis.telemetry.guardedAutoHeal.attempted += 1;
        if (normalized.guardedAutoHealSucceeded === true) {
          analysis.telemetry.guardedAutoHeal.succeeded += 1;
        } else {
          analysis.telemetry.guardedAutoHeal.failed += 1;
        }
      } else if (normalized.guardedAutoHealAttempted === false) {
        analysis.telemetry.guardedAutoHeal.skipped += 1;
      }

      if (normalized.mode === 'guarded') {
        analysis.guardedArtifacts += 1;
        if (normalized.acceptedLocator) {
          analysis.guardedAccepted.push(normalized);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error.';
      analysis.malformedArtifacts.push({ fileName, error: message });
    }
  }

  return analysis;
}

function toMarkdownTableRows(guardedAccepted) {
  if (guardedAccepted.length === 0) {
    return '| _None_ | _None_ | _None_ | _None_ | _None_ |\n';
  }

  return guardedAccepted
    .map(
      (event) =>
        `| ${event.eventId} | ${event.pageObjectName} | ${event.currentUrl ?? 'n/a'} | ${event.acceptedLocator ?? 'n/a'} | ${event.acceptedScore ?? 'n/a'} |`,
    )
    .join('\n');
}

function toMarkdownCounterRows(counter) {
  const entries = Object.entries(counter).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return '| _None_ | 0 |\n';
  }

  return entries.map(([key, value]) => `| ${key} | ${value} |`).join('\n');
}

export function buildGovernanceSummary({
  analysis,
  requireAcknowledgement,
  acknowledged,
  generatedAt = new Date(),
}) {
  const guardedAcceptedCount = analysis.guardedAccepted.length;
  const triageRequired = guardedAcceptedCount > 0;

  let status = 'pass';
  if (analysis.malformedArtifacts.length > 0) {
    status = 'blocked_malformed_artifacts';
  } else if (triageRequired && requireAcknowledgement && !acknowledged) {
    status = 'blocked_acknowledgement_required';
  } else if (triageRequired) {
    status = 'triage_required';
  }

  const summary = {
    generatedAt: generatedAt.toISOString(),
    status,
    requireAcknowledgement,
    acknowledged,
    triageRequired,
    artifactsDir: analysis.artifactsDir,
    totalArtifacts: analysis.totalArtifacts,
    parsedArtifacts: analysis.parsedArtifacts,
    malformedArtifacts: analysis.malformedArtifacts,
    guardedArtifacts: analysis.guardedArtifacts,
    guardedAcceptedCount,
    guardedAccepted: analysis.guardedAccepted,
    telemetry: analysis.telemetry,
  };

  const markdown = [
    '# Self-Healing Governance Summary',
    '',
    `- Generated At: ${summary.generatedAt}`,
    `- Status: ${summary.status}`,
    `- Require Acknowledgement: ${summary.requireAcknowledgement}`,
    `- Acknowledged: ${summary.acknowledged}`,
    `- Triage Required: ${summary.triageRequired}`,
    `- Total Artifacts: ${summary.totalArtifacts}`,
    `- Parsed Artifacts: ${summary.parsedArtifacts}`,
    `- Malformed Artifacts: ${summary.malformedArtifacts.length}`,
    `- Guarded Artifacts: ${summary.guardedArtifacts}`,
    `- Guarded Accepted Count: ${summary.guardedAcceptedCount}`,
    '',
    '## Telemetry Aggregates',
    '',
    '### Event Modes',
    '',
    '| Mode | Count |',
    '|---|---|',
    toMarkdownCounterRows(summary.telemetry.modes),
    '',
    '### Action Types',
    '',
    '| Action | Count |',
    '|---|---|',
    toMarkdownCounterRows(summary.telemetry.actions),
    '',
    '### Error Codes',
    '',
    '| Error Code | Count |',
    '|---|---|',
    toMarkdownCounterRows(summary.telemetry.errorCodes),
    '',
    `- Guarded Auto-Heal Attempted: ${summary.telemetry.guardedAutoHeal.attempted}`,
    `- Guarded Auto-Heal Succeeded: ${summary.telemetry.guardedAutoHeal.succeeded}`,
    `- Guarded Auto-Heal Failed: ${summary.telemetry.guardedAutoHeal.failed}`,
    `- Guarded Auto-Heal Skipped: ${summary.telemetry.guardedAutoHeal.skipped}`,
    '',
    '## Guarded Accepted Events',
    '',
    '| Event ID | Page Object | URL | Accepted Locator | Score |',
    '|---|---|---|---|---|',
    toMarkdownTableRows(summary.guardedAccepted),
    '',
  ].join('\n');

  return { summary, markdown };
}

async function writeSummaryFiles({
  summary,
  markdown,
  summaryJsonPath = DEFAULT_SUMMARY_JSON_PATH,
  summaryMarkdownPath = DEFAULT_SUMMARY_MD_PATH,
}) {
  await mkdir(path.dirname(summaryJsonPath), { recursive: true });
  await mkdir(path.dirname(summaryMarkdownPath), { recursive: true });

  await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(summaryMarkdownPath, `${markdown}\n`, 'utf8');

  return { summaryJsonPath, summaryMarkdownPath };
}

function emitGithubOutputs({ summary, summaryJsonPath, summaryMarkdownPath }) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const outputLines = [
    `status=${summary.status}`,
    `triage_required=${String(summary.triageRequired)}`,
    `acknowledged=${String(summary.acknowledged)}`,
    `guarded_accepted_count=${summary.guardedAcceptedCount}`,
    `malformed_count=${summary.malformedArtifacts.length}`,
    `summary_json_path=${summaryJsonPath}`,
    `summary_markdown_path=${summaryMarkdownPath}`,
    '',
  ].join('\n');

  return writeFile(process.env.GITHUB_OUTPUT, outputLines, {
    encoding: 'utf8',
    flag: 'a',
  });
}

export async function runSelfHealingGovernance({
  artifactsDir = process.env.SELF_HEAL_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR,
  requireAcknowledgement = parseBooleanFlag(process.env.SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED, true),
  acknowledged = parseBooleanFlag(process.env.SELF_HEAL_ACKNOWLEDGED, false),
  summaryJsonPath = process.env.SELF_HEAL_GOVERNANCE_SUMMARY_JSON ?? DEFAULT_SUMMARY_JSON_PATH,
  summaryMarkdownPath = process.env.SELF_HEAL_GOVERNANCE_SUMMARY_MD ?? DEFAULT_SUMMARY_MD_PATH,
} = {}) {
  const analysis = await analyzeSelfHealingArtifacts(artifactsDir);
  const { summary, markdown } = buildGovernanceSummary({
    analysis,
    requireAcknowledgement,
    acknowledged,
  });
  const files = await writeSummaryFiles({
    summary,
    markdown,
    summaryJsonPath,
    summaryMarkdownPath,
  });

  await emitGithubOutputs({
    summary,
    summaryJsonPath: files.summaryJsonPath,
    summaryMarkdownPath: files.summaryMarkdownPath,
  });

  console.log(
    `Self-healing governance status=${summary.status} guardedAccepted=${summary.guardedAcceptedCount} malformed=${summary.malformedArtifacts.length}`,
  );
  console.log(`Governance JSON summary: ${files.summaryJsonPath}`);
  console.log(`Governance Markdown summary: ${files.summaryMarkdownPath}`);

  if (summary.status === 'blocked_malformed_artifacts') {
    console.error('Malformed self-healing artifacts detected. Inspect summary for details.');
    return 1;
  }

  if (summary.status === 'blocked_acknowledgement_required') {
    console.error(
      'Guarded accepted self-healing candidates detected. Set SELF_HEAL_ACKNOWLEDGED=true after review.',
    );
    return 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runSelfHealingGovernance();
  process.exit(exitCode);
}
