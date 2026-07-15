import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectTextExcludes, expectTextIncludes } from '../../../helpers/contractAssertions';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function parseCodeowners(content: string): ReadonlyMap<string, readonly string[]> {
  const entries = new Map<string, readonly string[]>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (pattern !== undefined && owners.length > 0) {
      entries.set(pattern, owners);
    }
  }

  return entries;
}

describe('documentation surface contract', () => {
  it('ships API-grade onboarding and reference docs', () => {
    const requiredDocs = [
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/getting-started.md',
      'docs/writing-tests.md',
      'docs/configuration.md',
      'docs/api.md',
      'docs/adr/README.md',
      'docs/adr/0001-safety-first-self-healing.md',
      'docs/adr/0002-api-stability-tiers.md',
      'docs/adr/0003-scoring-and-slo-policy.md',
      'docs/adr/0004-redis-strategy.md',
      'docs/adr/0005-observability-boundary.md',
      'docs/adr/0006-release-policy.md',
      'docs/adr/0007-durable-trend-export.md',
      'docs/adr/0008-adoption-gated-extensibility.md',
      'docs/adr/0009-strategic-architecture.md',
      'docs/adr/0010-ci-cd-maturity-deferrals.md',
      'docs/architecture/adoption-readiness.md',
      'docs/architecture/locator-first-api.md',
      'docs/architecture/self-healing.md',
      'docs/architecture/traceability.md',
      'docs/operations/artifact-schemas.md',
      'docs/operations/lifecycle.md',
      'docs/operations/privacy-retention.md',
      'docs/operations/redis-production-runbook.md',
      'docs/operations/observability-contract.md',
      'docs/operations/observability-support-tiers.md',
      'docs/operations/trend-durable-export.md',
      'docs/operations/flakiness-analytics.md',
      'docs/operations/slo-dashboard-alerting.md',
    ];

    for (const docPath of requiredDocs) {
      expect(readRepoFile(docPath).trim().length).toBeGreaterThan(200);
    }
  });

  it('documents the vulnerability reporting and supported-version security policy', () => {
    const securityPolicy = readRepoFile('SECURITY.md');

    for (const text of [
      'Supported versions',
      'latest released `1.x` line',
      'private vulnerability reporting',
      'Do not submit real credentials or sensitive production data',
      'consumer-owned Redis, observability, CI runner, and retention infrastructure',
    ]) {
      expectTextIncludes(securityPolicy, {
        text,
        rationale:
          'Security policy must keep vulnerability reporting private and preserve library scope.',
      });
    }
  });

  it('documents privacy scope, capture controls, and consumer-owned retention', () => {
    const privacy = readRepoFile('docs/operations/privacy-retention.md');

    for (const dataClass of [
      'Screenshots',
      'DOM text',
      'Failure events',
      'Logs',
      'Redis records',
      'Telemetry',
      'Trends',
      'Audit records',
    ]) {
      expectTextIncludes(privacy, {
        text: dataClass,
        rationale: 'Privacy guide must enumerate public data classes for retention decisions.',
      });
    }
    for (const text of [
      'AURORAFLOW_ARTIFACT_PRIVACY_PRESET',
      'consumer-owned',
      'does not claim support for regulated PII',
    ]) {
      expectTextIncludes(privacy, {
        text,
        rationale:
          'Privacy guide must preserve safety boundary and consumer-owned retention wording.',
      });
    }
  });

  it('records durable trend export as optional and operator-owned', () => {
    const decision = readRepoFile('docs/adr/0007-durable-trend-export.md');
    const runbook = readRepoFile('docs/operations/trend-durable-export.md');
    const docs = `${decision}\n${runbook}`;

    for (const text of [
      'Durable trend export is optional and consumer/operator-owned',
      'bounded local JSONL remains the default',
      'does not upload trends or provision a durable analytics backend',
      '30 days or less',
      'must not delete or corrupt the local JSONL source',
    ]) {
      expectTextIncludes(docs, {
        text,
        rationale:
          'Trend export docs must preserve optionality, operator ownership, and source safety.',
      });
    }
  });

  it('records adoption-gated extensibility without authorizing expansion', () => {
    const adoption = readRepoFile('docs/architecture/adoption-readiness.md');
    const adr = readRepoFile('docs/adr/0008-adoption-gated-extensibility.md');
    const decisionLog = readRepoFile('docs/architecture/decision-log.md');
    const dataLayer = readRepoFile('docs/architecture/data-layer.md');
    const docs = `${adoption}\n${adr}\n${decisionLog}\n${dataLayer}`;

    for (const text of [
      'Evidence-gate result: not approved for expansion.',
      'Redis remains the only durable selector-store backend',
      '`MemorySelectorStore` remains a supported non-durable tier',
      'GitHub Actions remains the only first-class CI target',
      'No GitLab CI, Azure DevOps, Jenkins, CircleCI, Buildkite, or other CI template is approved',
      'New selector-store backends remain evidence-gated.',
      'Current trigger status: not met.',
      'no package split, hosted service, new backend, CI template family, or architecture expansion is authorized',
    ]) {
      expectTextIncludes(docs, {
        text,
        rationale:
          'Adoption governance docs must preserve evidence gates and non-expansion boundaries.',
      });
    }
  });

  it('records strategic decisions without authorizing expansion', () => {
    const adr = readRepoFile('docs/adr/0009-strategic-architecture.md');
    const decisionLog = readRepoFile('docs/architecture/decision-log.md');
    const docs = `${adr}\n${decisionLog}`;

    for (const text of [
      'This ADR is decision-only and authorizes no implementation',
      'AuroraFlow keeps one `auroraflow` npm package',
      'Hosted SAT remains a deferred non-goal',
      'Feature-level SAT (Selector Analysis Tooling) remains implemented and supported',
      'Observability assets remain in-package',
      'No companion observability repository is extracted',
      'adoption evidence, a named owner, a migration plan, and a release strategy',
    ]) {
      expectTextIncludes(docs, {
        text,
        rationale:
          'Strategic ADR must keep package split, hosted SAT, and observability deferred without authorizing expansion.',
      });
    }
  });

  it('records CI/CD maturity deferrals without enabling publish or governance expansion', () => {
    const adr = readRepoFile('docs/adr/0010-ci-cd-maturity-deferrals.md');
    const decisionLog = readRepoFile('docs/architecture/decision-log.md');
    const releaseProcess = readRepoFile('docs/operations/release-process.md');
    const docs = `${adr}\n${decisionLog}\n${releaseProcess}`;

    for (const text of [
      'harden-runner starts audit-only',
      'OpenSSF Scorecard must record a measured score before any threshold is proposed',
      'Do not enable mandatory code-owner review, mandatory signed commits, merge queue',
      'Merge queue requires every required workflow to support `merge_group` before enablement.',
      'No npm publish job, no `id-token: write` publish permission, and no `NPM_TOKEN`',
      'explicit maintainer release decision, a protected `release` environment, npm trusted publisher configuration',
      'same-commit Quality/Security evidence green before publish',
      'No container image scanning, Kubernetes/deploy gates, database migration gates, hosted SAT, hosted observability',
      'Keep the six-workflow topology',
      'Keep six workflows, no mandatory code-owner review, no signed-commit requirement, no merge queue, no publish job, no `NPM_TOKEN`',
    ]) {
      expectTextIncludes(docs, {
        text,
        rationale:
          'CI/CD maturity docs must preserve Phase 6 deferrals and avoid accidental publish or governance expansion.',
      });
    }
  });

  it('documents the implemented lifecycle and fixture contract', () => {
    const lifecycle = readRepoFile('docs/operations/lifecycle.md');
    const api = readRepoFile('docs/api.md');
    const development = readRepoFile('docs/development.md');
    const docs = `${lifecycle}\n${api}\n${development}`;

    for (const requiredTerm of [
      'closeAuroraFlow(context?)',
      'auroraflow/playwright',
      'one-shot per runtime context',
      'concurrent calls for the same context coalesce',
      'reverse registration order',
      'aggregate error',
      'disabled subsystems are no-ops',
      'PageFactory(page)',
      'Playwright `Page`, `BrowserContext`, and `Browser` objects are never closed',
      'no process-exit hooks',
    ]) {
      expectTextIncludes(docs, {
        text: requiredTerm,
        rationale: 'Lifecycle docs must preserve the public lifecycle API contract.',
      });
    }

    for (const staleText of ['implementation remains a planned task', 'labeled as planned until']) {
      expectTextExcludes(`${lifecycle}\n${development}`, {
        text: staleText,
        rationale:
          'Lifecycle docs must not keep planned-only wording after the lifecycle helper shipped.',
      });
    }
  });

  it('documents locator-first API review boundaries before prototypes ship', () => {
    const design = readRepoFile('docs/architecture/locator-first-api.md');

    for (const text of [
      'Draft for API review; no prototypes shipped',
      'click(selector: string, options?: ActionOptions)',
      'click(locator: Locator, options?: ActionOptions)',
      'type(selector: string, text: string, options?: ActionOptions)',
      'type(locator: Locator, text: string, options?: ActionOptions)',
      'Do not remove, rename, or weaken string-selector APIs',
      'add prototypes only after API review',
    ]) {
      expectTextIncludes(design, {
        text,
        rationale:
          'Locator-first design must preserve string-selector compatibility and review gating.',
      });
    }
  });

  it('keeps current maturity claims aligned with implemented promotion workflows', () => {
    const docs = [
      'README.md',
      'docs/development.md',
      'docs/architecture/self-healing.md',
      'docs/api.md',
    ]
      .map(readRepoFile)
      .join('\n');

    for (const text of [
      'reviewable pending promotion records',
      'approve, reject, conflict, and rollback workflows',
      'source-code rewrites remain out of scope',
    ]) {
      expectTextIncludes(docs, {
        text,
        rationale: 'Self-healing docs must reflect implemented promotion workflow maturity.',
      });
    }
    for (const text of [
      'not active persistence workflows',
      'SAT history and promotion logic are not wired to Redis yet',
      'reviewed approval/rejection/rollback flows and source-code rewrites remain out of scope',
    ]) {
      expectTextExcludes(docs, {
        text,
        rationale: 'Self-healing docs must not preserve stale pre-promotion maturity wording.',
      });
    }
  });

  it('documents lightweight contribution governance and advisory ownership', () => {
    const contributing = readRepoFile('CONTRIBUTING.md');
    const codeowners = readRepoFile('.github/CODEOWNERS');
    const adrIndex = readRepoFile('docs/adr/README.md');
    const adrDocs = [
      'docs/adr/0001-safety-first-self-healing.md',
      'docs/adr/0002-api-stability-tiers.md',
      'docs/adr/0003-scoring-and-slo-policy.md',
      'docs/adr/0004-redis-strategy.md',
      'docs/adr/0005-observability-boundary.md',
      'docs/adr/0006-release-policy.md',
    ]
      .map(readRepoFile)
      .join('\n');

    for (const text of ['lightweight', 'advisory CODEOWNERS', 'Confirm or replace owner handles']) {
      expectTextIncludes(contributing, {
        text,
        rationale: 'Contribution docs must preserve lightweight advisory governance wording.',
      });
    }
    expect(
      parseCodeowners(codeowners).get('*'),
      'CODEOWNERS must keep documented advisory ownership route until maintainers confirm replacement.',
    ).toEqual(['@jsugg']);
    expectTextIncludes(adrIndex, {
      text: 'ADR 0001',
      rationale: 'ADR index must expose accepted architecture decision records.',
    });

    for (const topic of [
      'Safety-first self-healing',
      'API stability tiers',
      'Scoring and SLO policy',
      'Redis strategy',
      'Observability boundary',
      'Release policy',
    ]) {
      expectTextIncludes(adrDocs, {
        text: topic,
        rationale: 'ADR docs must preserve accepted decision topics.',
      });
    }
  });
});
