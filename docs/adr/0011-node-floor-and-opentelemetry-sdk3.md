# ADR 0011: Node.js floor and OpenTelemetry SDK 3

- Status: Accepted
- Date: 2026-11-10
- Related decisions: `AUR-DEC-015`, `AUR-DEC-004`, `AUR-DEC-005`, `AUR-DEC-008`; ADR 0005, ADR 0010
- Owners: maintainer / observability and release reviewers

## Context

The OpenTelemetry JavaScript SDK 3.x line (`@opentelemetry/resources`, `sdk-metrics`, and `core` 3.x, plus experimental packages 0.300 and later) declares `engines.node >=22.15.0` and requires `@opentelemetry/api` 1.10. Upstream ties api 1.10 to SDK 3.x: SDK 2.x packages declare `@opentelemetry/api <1.10.0`, so mixing the lines fails `npm ci` with `ERESOLVE`. Node.js 20 reached end of life on 2026-04-30, and Node.js 26 became an LTS line in 2026-10. The previous support surface, `engines.node >=20 <25` with a 20/22/24 CI matrix, therefore blocked both the SDK 3 line and the current LTS.

SDK 3 also widens the default `NodeSDK` resource detectors to environment, process, host, OS, and service-instance detection. Under the previous configuration AuroraFlow exported exactly the resource attributes it configured, so an unmanaged upgrade would add host names, OS details, process command lines, and a random `service.instance.id` to every exported span and metric. That conflicts with the artifact-first privacy posture of ADR 0005 and the data-minimization decisions `AUR-DEC-004` and `AUR-DEC-005`.

## Decision

1. **Runtime support.** `engines.node` is `>=22.15.0 <27`, which is the SDK 3 floor; Node.js 20 support is removed. The `Node Compatibility` matrix runs Node.js 22, 24, and 26. Canonical single-version lanes stay on Node.js 22.
2. **OpenTelemetry line.** Runtime telemetry uses `@opentelemetry/api` 1.10 with the SDK 3.x line (`@opentelemetry/sdk-node`, OTLP proto exporters 0.301+, and `resources`/`sdk-metrics` 3.x).
3. **Telemetry resource parity.** `OtelTelemetry` passes an explicit empty `resourceDetectors` list together with `resourceFromAttributes(config.resourceAttributes)`. The exported resource is exactly the attribute set AuroraFlow resolves from its configuration: service, deployment, VCS, CI, and AuroraFlow correlation keys plus `OTEL_RESOURCE_ATTRIBUTES`. SDK default detectors and `OTEL_NODE_RESOURCE_DETECTORS` are deliberately not honored.
4. **Opt-in.** Operators who need extra resource attributes add them explicitly through `OTEL_RESOURCE_ATTRIBUTES`. A detector opt-in (for example host or OS detection) is not added now. It would introduce a new configuration surface and new privacy-sensitive attribute classes that need review under `AUR-DEC-004`, so it is not a trivial switch.

## Consequences

- Consumers on Node.js 20 or Node.js 22 below 22.15.0 must upgrade before adopting this version. The change is breaking and is recorded in the changelog.
- Telemetry content does not change across the SDK upgrade. The OTLP integration test decodes the exported trace and metric resources and asserts that they equal the configured attributes. It fails if any detector-supplied attribute appears.
- Teams that relied on `OTEL_NODE_RESOURCE_DETECTORS` see no change, because AuroraFlow already disabled resource detection before this decision.

## Revisit triggers

- A maintainer-approved request for detector-supplied attributes, with a privacy review of each attribute class.
- An OpenTelemetry SDK major or `engines` change that moves the Node.js floor again.
- A Node.js LTS line reaching end of life, or a new LTS line becoming available, which moves the matrix and the `engines` upper bound.
