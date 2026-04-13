import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE_WORKFLOWS = [
  'examples/ci/quality.workflow.example.yml',
  'examples/ci/e2e-matrix.workflow.example.yml',
  'examples/ci/security.workflow.example.yml',
] as const;

describe('example workflow template contract', () => {
  it('keeps Node24 runtime opt-in and immutable action refs', () => {
    for (const templatePath of TEMPLATE_WORKFLOWS) {
      const content = readFileSync(path.join(process.cwd(), templatePath), 'utf8');

      expect(content).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'");
      expect(content).toMatch(/actions\/checkout@[a-f0-9]{40}/);
      expect(content).toMatch(/actions\/setup-node@[a-f0-9]{40}/);
      expect(content).toMatch(/actions\/upload-artifact@[a-f0-9]{40}/);
      expect(content).toContain('concurrency:');
      expect(content).toContain('timeout-minutes:');
    }
  });

  it('does not reference known deprecated Node20-target action SHAs', () => {
    const disallowedPatterns = [
      /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/,
      /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
      /actions\/cache@0057852bfaa89a56745cba8c7296529d2fc39830/,
      /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
      /actions\/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065/,
      /dorny\/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36/,
      /actions\/dependency-review-action@/,
    ];

    for (const templatePath of TEMPLATE_WORKFLOWS) {
      const content = readFileSync(path.join(process.cwd(), templatePath), 'utf8');
      for (const pattern of disallowedPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});
