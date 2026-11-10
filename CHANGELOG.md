# Changelog

All notable changes to AuroraFlow are documented in this file. This file is the durable record referred to as "the changelog" by [API stability](docs/api-stability.md), which governs deprecation announcements, tier changes, and removal lists.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). [API stability](docs/api-stability.md) defines which exports that guarantee covers.

AuroraFlow has not been published to the npm registry yet; see the [release process](docs/operations/release-process.md#current-state-dry-run-only) for the canonical release state. Entries recorded before the first publish therefore cover pre-release development, and the first published version consolidates them into its release entry.

Curated entries are written by the release maintainer from the `changelog-draft.md` that each [release dry run](docs/operations/release-process.md#dry-run-evidence) produces. That draft is a workflow artifact with 30-day retention, so this file — not the artifact — is the durable record.

## [Unreleased]

Pre-release development is tracked in the Git history and the Conventional Commits log. Curated entries accumulate here until the first published release.

### Removed

- **BREAKING:** Node.js 20 support. `engines.node` is now `>=22.15.0 <27`, the floor required by the OpenTelemetry SDK 3 line. CI tests Node.js 22, 24, and 26 ([ADR 0011](docs/adr/0011-node-floor-and-opentelemetry-sdk3.md)).

### Changed

- **BREAKING:** Runtime telemetry dependencies move to the OpenTelemetry SDK 3 line: `@opentelemetry/api` 1.10, `@opentelemetry/sdk-node` and the OTLP proto exporters 0.301, and `@opentelemetry/resources`/`sdk-metrics` 3.1. Consumers that install their own OpenTelemetry API must use `@opentelemetry/api` 1.10.
- Exported telemetry resource attributes are unchanged by the upgrade. Resource detectors stay explicitly disabled, so the SDK 3 default host, OS, process, and `service.instance.id` attributes are not emitted and `OTEL_NODE_RESOURCE_DETECTORS` is not honored. Add attributes through `OTEL_RESOURCE_ATTRIBUTES`.
