# Durable Trend Export

AuroraFlow trend persistence is artifact-first. Flakiness and SLO commands can append schema-versioned points to bounded local JSONL files, but local files, CI caches, and CI artifacts are not durable analytics storage.

## Decision and ownership

Durable export is optional and consumer/operator-owned. AuroraFlow does not provision a backend, hold destination credentials, or upload trend data. Local development writes no trend file unless `--trend-output` or `AURORAFLOW_TREND_OUTPUT` is set.

Operators choosing durable history own:

- destination selection, credentials, TLS/encryption, access control, and network policy;
- immutable object naming or destination concurrency semantics;
- retention, deletion, legal hold, backup/restore, capacity, cost, and incident response;
- privacy review for branch, commit, workflow, project, test, and self-healing metadata;
- alerts and retry policy for their export step.

Use the shortest useful retention. The repository policy recommends 30 days or less unless a separate compliance or legal-hold decision requires longer.

## Safe handoff path

1. Generate bounded JSONL with `--trend-output` and an explicit `--trend-limit`.
2. Keep the generated JSONL in the ordinary CI artifact set so failed uploads do not erase local evidence.
3. Validate repository schemas with `npm run schemas:check`; tolerant readers may skip malformed or future-version lines, but an export step should report every skipped line.
4. Copy the completed file in a separate operator-owned CI or operations step. Use a run-unique destination key before any optional compaction to avoid concurrent lost updates.
5. Verify destination checksum, object count, and retention policy before removing ephemeral copies.

The producer writes each bounded JSONL file atomically. Export only after the producer command finishes; do not upload its temporary files or let multiple jobs overwrite one shared mutable object.

## Default and failure behavior

- No export destination is configured by AuroraFlow.
- Local and routine package development remain artifact-only with live telemetry disabled and no durable upload.
- Enabling durable export does not enable OpenTelemetry or the observability stack.
- Export retries, timeouts, idempotency, and merge-blocking policy belong to the operator. Failures must be surfaced and must preserve the source artifact.
- Rollback is removal or disablement of the operator-owned upload step; local bounded trends and tolerant reads continue unchanged.

See [Flakiness analytics](./flakiness-analytics.md), [SLO dashboard and alerting](./slo-dashboard-alerting.md), [artifact schemas](./artifact-schemas.md), and [privacy and retention](./privacy-retention.md).
