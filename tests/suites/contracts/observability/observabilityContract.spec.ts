import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_METRIC_NAMES } from '../../../../src/framework/observability/metricNames';
import { RESOURCE_ATTRIBUTE_NAMES } from '../../../../src/framework/observability/telemetryConfig';

const CONTRACT_PATH = path.join(process.cwd(), 'docs', 'operations', 'observability-contract.md');

describe('observability contract documentation', () => {
  it('documents every supported live metric name', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const metricName of REQUIRED_METRIC_NAMES) {
      expect(contract).toContain(`\`${metricName}\``);
    }
  });

  it('documents every required resource attribute', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const attributeName of RESOURCE_ATTRIBUTE_NAMES) {
      expect(contract).toContain(`\`${attributeName}\``);
    }
  });

  it('documents no-op defaults and raw selector safeguards', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    expect(contract).toContain('must not export live telemetry unless');
    expect(contract).toContain('Raw selectors');
    expect(contract).toContain('AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true');
  });
});
