# Redis Selector Registry Production Runbook

This runbook documents Redis-backed selector registry operations. AuroraFlow can use Redis as an optional durable selector-store backend, but Redis is always consumer/operator-owned. AuroraFlow does not provision, patch, back up, monitor, scale, or incident-manage consumer Redis.

## Scope and Ownership

- Use `MemorySelectorStore` for unit tests, fixture-scoped experiments, and local non-durable state.
- Use `RedisSelectorStore` when active selectors, candidate history, pending promotions, or audit records must survive a single Node process.
- Treat every Redis deployment, credential, backup, retention policy, alert, and incident response action as consumer/operator-owned.
- Do not treat AuroraFlow key prefixes as authorization. Prefixes are namespace hygiene for scans, cleanup, and collision avoidance; real isolation comes from network policy, Redis ACL users, credentials, database/instance separation, and operator review controls.
- Keep shared registries narrow. Shared promotion workflows require the existing shared authorization mode, CODEOWNERS evidence, protected workflow evidence, and environment-specific tenancy rules before mutating selectors.

## Compatibility

AuroraFlow integration tests currently exercise Redis `7.2-alpine`. Production or managed Redis-compatible services must support:

- TLS or an equivalent encrypted private transport approved by the operator;
- username/password authentication when ACLs are enabled;
- `GET`, `MGET`, `SET`, `DEL`, `SCAN`, `PING`, and `EVAL`;
- Lua `cjson` support for compare-and-set and atomic JSON merge scripts;
- key TTLs and Redis server time semantics compatible with managed snapshots.

If a managed service disables `EVAL` or restricts Lua in a way that breaks `cjson`, do not use it for durable selector history or reviewed promotion workflows until a compatible store adapter exists.

## Key and Namespace Model

Two namespace layers are in use:

| Layer | Control | Purpose |
| --- | --- | --- |
| Physical Redis prefix | `AURORAFLOW_REDIS_KEY_PREFIX` | Prepended to every Redis key by `RedisClient`; default `auroraflow`. |
| Selector registry namespace | `SELF_HEAL_REGISTRY_NAMESPACE` | Logical active selector namespace; default `selector-registry`. |

The registry derives separate namespaces for active records, indexes, candidate history, pending promotions, and audit records. Use distinct prefixes per environment, repository, or tenant, such as `auroraflow:ci:checkout`, but pair that convention with ACLs and network boundaries. Prefixes reduce accidental collisions; they do not prevent a credential with broad permissions from reading or writing another prefix.

`AURORAFLOW_REDIS_KEY_PREFIX` is validated to 64 characters or less and may use letters, numbers, `:`, `_`, and `-`. Trailing colons are normalized away before keys are qualified.

## TLS

- Prefer `rediss://` in `AURORAFLOW_REDIS_URL`, or set `AURORAFLOW_REDIS_TLS=true` when host/port variables are used.
- Terminate TLS at the Redis endpoint or a private proxy approved by the operator; do not expose plain Redis on public networks.
- Use certificate chains trusted by the Node runtime or managed service. Custom CA or mTLS support is not exposed as AuroraFlow environment variables today; require an explicit runtime change before claiming custom certificate support.
- Add a preflight smoke that connects with the same TLS settings used by CI and runs `PING` before enabling `SELF_HEAL_REGISTRY_REQUIRED=true`.

## Authentication and Secret Handling

- Store `AURORAFLOW_REDIS_USERNAME`, `AURORAFLOW_REDIS_PASSWORD`, or URL credentials in a secret manager or CI encrypted secrets, never in repository files.
- Use one Redis credential per environment and tenancy boundary. Rotate credentials on a schedule and immediately after any suspected artifact, log, screenshot, or workflow leak.
- Prefer username/password ACL users over a shared default user. Disable or rename broad shared users when the managed service allows it.
- Keep credentials out of logs. AuroraFlow configuration diagnostics do not echo Redis secret values; operators must still avoid printing process environments.

## ACL and Network Policy

Recommended production posture:

1. Put Redis on a private network reachable only from approved CI runners and operator workstations.
2. Create a least-privilege ACL user for AuroraFlow registry operations.
3. Restrict key patterns to the approved physical prefix when the Redis service can enforce key-level ACLs.
4. Allow only the command set AuroraFlow needs: `GET`, `MGET`, `SET`, `DEL`, `SCAN`, `PING`, `EVAL`, and `SELECT` only when a non-default database is used.
5. Deny admin, replication, module, config, flush, and arbitrary scripting commands outside the minimum Lua execution required by AuroraFlow.

Example ACL intent, not a portable production command:

```text
user auroraflow on >REDACTED ~auroraflow:ci:checkout:* +get +mget +set +del +scan +ping +eval
```

Managed Redis ACL syntax and `EVAL` key enforcement differ. If the service cannot constrain Lua to the intended key pattern, use a dedicated Redis instance, database, VPC, or credential boundary rather than relying on prefixes.

## Backup and Restore

Backups are operator-owned. AuroraFlow writes durable selector state, but it does not create Redis snapshots or restore them.

Minimum backup policy:

- Enable managed snapshots or Redis-native RDB/AOF backups for environments that rely on durable active selector records.
- Store backups in environment-owned encrypted storage with access separate from the runtime Redis credential.
- Align backup retention with the privacy and retention guide. Remember that backups can retain data after AuroraFlow TTLs or cleanup have deleted live keys.
- Run restore drills into an isolated Redis endpoint before relying on backups for incident recovery.

Restore drill:

1. Freeze mutating workflows: stop promotion approval/rollback jobs and disable `SELF_HEAL_REGISTRY_MODE=write_pending` in affected CI runs.
2. Restore the snapshot to an isolated endpoint with a new credential.
3. Configure a non-production runner with the restored endpoint and prefix.
4. Run read-only smoke checks: `PING`, list active selectors, list pending promotions, and run self-healing governance against copied artifacts.
5. Compare key counts, representative selector versions, and recent audit entries against expected evidence.
6. Switch production CI only after the restored endpoint passes smoke checks.
7. Re-enable mutation workflows and record the restore timestamp, snapshot ID, and validation result in the incident ticket.

After restore, run `npm run self-heal:repair` and review its dry-run schema/index drift summary. Apply with `npm run self-heal:repair -- --apply` only after preserving restored snapshot. Never hand-edit active selector, index, promotion, or audit keys.

## Eviction Policy

Use `maxmemory-policy noeviction` for durable selector registries. Eviction is a data-loss event:

- evicted active selector records can remove curated locator knowledge;
- evicted index keys can make listings incomplete;
- evicted history records reduce scoring evidence;
- evicted pending promotion or audit records weaken review evidence.

Avoid `allkeys-lru`, `allkeys-lfu`, `volatile-lru`, and similar eviction policies for shared or durable registries. If a managed service requires an eviction policy, use a dedicated instance with enough headroom and alerts so eviction never occurs under expected load.

Alert on:

- `evicted_keys > 0`;
- memory above the operator-approved threshold, commonly 75-80%;
- rejected connections or authentication failures;
- sustained command latency or Redis CPU saturation.

## Retention and Cleanup

AuroraFlow enforces or records the following live-key retention behavior:

| Data | Default behavior | Operator action |
| --- | --- | --- |
| Active selector records | No TTL while active. | Delete only through reviewed workflow or planned migration. |
| Candidate history | 30-day default and hard cap. | Choose shorter TTLs when practical; monitor volume. |
| Pending promotions | 30-day default unless a shorter caller TTL is used. | Review or clean up sooner when no longer useful. |
| Audit records | New records carry 30-day retention metadata by default. | Run cleanup only after reviewing dry-run output; preserve legal holds separately. |

Use `npm run self-heal:cleanup` or `npm run self-heal:promotions -- cleanup` for registry cleanup. Cleanup is dry-run by default and deletes only with `--apply` or `SELF_HEAL_REGISTRY_CLEANUP_APPLY=true`. Cleanup does not delete managed snapshots, object-storage exports, CI artifacts, logs, or telemetry copies.

## Capacity Planning

Plan capacity from observed key counts and serialized payload sizes, not from test fixtures alone. At minimum track:

- total keys under the physical prefix;
- active selector count;
- unique candidate-history records within the 30-day window;
- pending promotion and audit record counts;
- average and p95 `MEMORY USAGE` for active, history, promotion, and audit keys;
- Redis `used_memory`, fragmentation ratio, CPU, command latency, and network I/O;
- CI runner fan-out and worst-case self-healing failure volume.

Sizing heuristic:

```text
keys ~= active selectors + selector indexes + unique candidate histories
      + pending promotions + audit records
memory ~= sampled p95 bytes per key class * key count * fragmentation headroom
```

Keep at least 30-50% memory headroom after the 30-day history window is full. Use shorter history TTLs, run-level self-healing budgets, and lower CI fan-out before scaling shared Redis into eviction pressure. Prefer `SCAN`-based sampling for prefix metrics; do not run blocking `KEYS` in production.

## Incident Guidance

### Connection, TLS, or Auth Failures

1. Check runner network reachability, security groups, Redis endpoint, and DNS.
2. Confirm the runtime uses the intended `redis://` or `rediss://` URL and TLS flag.
3. Verify ACL user status, password rotation timing, and database index.
4. Run a minimal `PING` smoke with the same credential from an approved runner.
5. If Redis is required, keep `SELF_HEAL_REGISTRY_REQUIRED=true` so failures stay visible. If Redis is optional for the affected run, document the degraded registry behavior before disabling required mode.

### Unauthorized Access or Credential Exposure

1. Disable or rotate the affected ACL user immediately.
2. Revoke CI secrets and invalidate any copied local environment files.
3. Snapshot current Redis for forensics if policy allows; otherwise delete exposed non-production evidence according to the privacy guide.
4. Audit active selectors, promotions, and audit records for unexpected changes.
5. Reissue a least-privilege credential and update the incident ticket with scope, affected prefixes, and follow-up controls.

### Eviction, OOM, or Capacity Exhaustion

1. Stop write-heavy workflows and promotion mutations.
2. Confirm `evicted_keys`, `maxmemory-policy`, `used_memory`, and slowlog data.
3. Increase memory or reduce load before re-enabling writes.
4. Restore from the latest known-good backup if active selector or index records were evicted.
5. Shorten history retention or failure-run budgets only after preserving the evidence needed for the incident review.

### Suspected Data Corruption

1. Pause promotion approval, rollback, and cleanup commands.
2. Preserve a Redis snapshot and the related self-healing artifacts.
3. Identify affected physical prefix, logical namespace, selector IDs, and time window.
4. Prefer restore to an isolated endpoint and compare representative records.
5. Do not hand-edit records unless the maintainer and data owner approve the exact change plan.

### Latency or Command Errors

1. Check Redis CPU, network, memory fragmentation, slowlog, and managed-service throttling.
2. Reduce CI parallelism or registry write volume while investigating.
3. Review retry settings only after capacity and network issues are understood.
4. Keep telemetry/log evidence redacted; selectors and URLs can be sensitive.

## Production Readiness Checklist

- [ ] Redis endpoint is private or otherwise network-restricted.
- [ ] TLS is enabled or an operator-approved private encrypted transport exists.
- [ ] Dedicated ACL user and least-privilege command/key policy are configured.
- [ ] `AURORAFLOW_REDIS_KEY_PREFIX` and `SELF_HEAL_REGISTRY_NAMESPACE` are unique for the environment and documented as namespace hygiene, not authorization.
- [ ] Managed service supports `EVAL` with Lua `cjson`.
- [ ] `maxmemory-policy noeviction` is configured for durable registries.
- [ ] Backup and restore drills have passed in an isolated endpoint.
- [ ] Retention and cleanup owners are documented.
- [ ] Alerts cover auth failures, connectivity, latency, memory, and eviction.
- [ ] Incident contacts and escalation path are known to CI owners and operators.
