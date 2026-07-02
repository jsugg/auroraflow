import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowActionReferences, readWorkflowModel } from '../../../helpers/workflowModel';

const WORKFLOW_FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/quality.yml',
  '.github/workflows/examples.yml',
  '.github/workflows/security.yml',
  '.github/workflows/playwright-peer-matrix.yml',
  '.github/workflows/release.yml',
] as const;
const PR_AND_EVIDENCE_WORKFLOW_FILES = [
  '.github/workflows/quality.yml',
  '.github/workflows/examples.yml',
  '.github/workflows/security.yml',
] as const;
const EVIDENCE_ONLY_WORKFLOW_FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/playwright-peer-matrix.yml',
  '.github/workflows/release.yml',
] as const;
const ACTION_FILES = ['.github/actions/setup-node-cache/action.yml'] as const;
const FULL_LENGTH_SHA_ACTION_REFERENCE = /^[^@\s]+@[a-f0-9]{40}$/;
const LOCKED_INSTALL_ACTION = './.github/actions/setup-node-cache';

function getCompositeActionReferences(relativePath: string): readonly string[] {
  const content = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  return [...content.matchAll(/^ {6}uses:\s*(.+)$/gm)]
    .map((match) => parseActionReference(match[1] ?? ''))
    .filter((reference) => reference.length > 0);
}

function parseActionReference(value: string): string {
  const commentIndex = value.search(/\s#/);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

function getAllActionReferences(): readonly string[] {
  return [
    ...WORKFLOW_FILES.flatMap((workflowPath) =>
      getWorkflowActionReferences(readWorkflowModel(workflowPath)),
    ),
    ...ACTION_FILES.flatMap((actionPath) => getCompositeActionReferences(actionPath)),
  ];
}

describe('workflow actions runtime contract', () => {
  it('opts JavaScript actions into Node 24 runtime', () => {
    for (const workflowPath of WORKFLOW_FILES) {
      const workflow = readWorkflowModel(workflowPath);
      expect(
        workflow.env.get('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'),
        `${workflowPath} must pin JavaScript actions to Node 24 runtime compatibility.`,
      ).toBe('true');
    }
  });

  it('does not reference known Node20-target actions', () => {
    const disallowedReferences = [
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830',
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
      'dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36',
    ];
    const disallowedReferenceSet = new Set<string>(disallowedReferences);

    for (const actionReference of getAllActionReferences()) {
      expectInvariant(
        !disallowedReferenceSet.has(actionReference) &&
          !actionReference.startsWith('actions/dependency-review-action@'),
        `Workflows and local actions must avoid Node20-target action reference ${actionReference}.`,
      );
    }
  });

  it('pins every external workflow action to a full-length immutable SHA', () => {
    for (const actionReference of getAllActionReferences()) {
      if (actionReference.startsWith('./')) {
        continue;
      }

      expectInvariant(
        FULL_LENGTH_SHA_ACTION_REFERENCE.test(actionReference),
        `Workflows and local actions must SHA-pin external action reference ${actionReference}.`,
      );
    }
  });

  it('keeps local reusable workflows and actions repository-scoped for SHA policy compatibility', () => {
    const localReferences = WORKFLOW_FILES.flatMap((workflowPath) =>
      getWorkflowActionReferences(readWorkflowModel(workflowPath))
        .filter((actionReference) => actionReference.startsWith('./'))
        .map((actionReference) => ({ actionReference, workflowPath })),
    );

    expectInvariant(
      localReferences.length > 0,
      'At least one local reusable workflow reference must cover repository SHA policy compatibility.',
    );
    for (const { actionReference, workflowPath } of localReferences) {
      expectInvariant(
        (actionReference.startsWith('./.github/workflows/') ||
          actionReference.startsWith('./.github/actions/')) &&
          !actionReference.includes('@'),
        `${workflowPath} local reference must stay repository-scoped: ${actionReference}.`,
      );
    }
  });

  it('standardizes locked installs and browser cache through the local composite action', () => {
    const compositeAction = readFileSync(
      path.join(process.cwd(), '.github/actions/setup-node-cache/action.yml'),
      'utf8',
    );
    const workflowsUsingComposite = WORKFLOW_FILES.filter((workflowPath) =>
      getWorkflowActionReferences(readWorkflowModel(workflowPath)).includes(LOCKED_INSTALL_ACTION),
    );

    expect(workflowsUsingComposite.sort()).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/examples.yml',
      '.github/workflows/quality.yml',
      '.github/workflows/release.yml',
      '.github/workflows/security.yml',
    ]);
    expectTextIncludes(compositeAction, {
      text: 'npm run lockfile:check',
      rationale: 'Composite locked install must fail early on package-lock drift.',
    });
    expectTextIncludes(compositeAction, {
      text: 'npm ci',
      rationale: 'Composite locked install must keep reproducible npm ci semantics.',
    });
    expectTextIncludes(compositeAction, {
      text: "hashFiles('package-lock.json', 'configs/playwright.config.ts', 'configs/playwright.*.ts')",
      rationale: 'Playwright browser cache key must include lockfile and browser config hashes.',
    });
    expectTextIncludes(compositeAction, {
      text: '${{ runner.os }}-playwright-${{ inputs.cache-version }}-${{ inputs.cache-namespace }}-',
      rationale:
        'Playwright browser cache must keep namespace restore keys for warm dependency bumps.',
    });
  });

  it('cancels stale pull-request runs without cancelling main evidence runs', () => {
    for (const workflowPath of PR_AND_EVIDENCE_WORKFLOW_FILES) {
      const workflow = readWorkflowModel(workflowPath);
      expect(
        workflow.concurrency.get('cancel-in-progress'),
        `${workflowPath} must cancel only stale pull-request runs.`,
      ).toBe("${{ github.event_name == 'pull_request' }}");
    }
  });

  it('keeps scheduled, manual, and release evidence runs non-cancellable', () => {
    for (const workflowPath of EVIDENCE_ONLY_WORKFLOW_FILES) {
      const workflow = readWorkflowModel(workflowPath);
      expect(
        workflow.concurrency.get('cancel-in-progress'),
        `${workflowPath} must preserve evidence runs instead of cancelling in-progress executions.`,
      ).toBe('false');
    }
  });
});
