import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/quality.yml',
  '.github/workflows/examples.yml',
  '.github/workflows/security.yml',
] as const;

describe('workflow actions runtime contract', () => {
  it('opts JavaScript actions into Node 24 runtime', () => {
    for (const workflowPath of WORKFLOW_FILES) {
      const workflowContent = readFileSync(path.join(process.cwd(), workflowPath), 'utf8');
      expect(workflowContent).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'");
    }
  });

  it('does not reference known Node20-target actions', () => {
    const disallowedPatterns = [
      /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/,
      /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
      /actions\/cache@0057852bfaa89a56745cba8c7296529d2fc39830/,
      /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
      /actions\/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065/,
      /dorny\/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36/,
      /actions\/dependency-review-action@/,
    ];

    for (const workflowPath of WORKFLOW_FILES) {
      const workflowContent = readFileSync(path.join(process.cwd(), workflowPath), 'utf8');
      for (const pattern of disallowedPatterns) {
        expect(workflowContent).not.toMatch(pattern);
      }
    }
  });
});
