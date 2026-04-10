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
});
