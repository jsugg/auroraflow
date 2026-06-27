# ADR 0008: Adoption-gated backend and CI extensibility

- Status: Accepted
- Date: 2026-06-27
- Related decisions: `AUR-DEC-001`, `AUR-DEC-006`, `AUR-DEC-009`, `AUR-DEC-011`; ADR 0004
- Owners: maintainer / product, architecture, data, and DevEx reviewers

## Context

This ADR prevents speculative expansion after the existing foundation work. The repository has a strong one-package TypeScript Playwright library, optional Redis selector-store support, non-durable memory-store support, artifact-first observability, and first-class GitHub Actions workflows. It does not yet have external adoption evidence, support-owner capacity, or user requests that justify package splitting, additional durable stores, non-GitHub CI templates, or a broader platform architecture.

The evidence snapshot is recorded in [`../architecture/adoption-readiness.md`](../architecture/adoption-readiness.md). On 2026-06-27, registry and project-demand checks found no npm package publication for `auroraflow`, no npm download record, and no open or closed GitHub issues in `jsugg/auroraflow`.

## Decision

AuroraFlow keeps the current scope until an evidence gate approves expansion:

- one npm package remains the supported product shape;
- Redis remains the only durable selector-store backend and stays consumer/operator-owned;
- `MemorySelectorStore` remains a supported non-durable tier for tests, fixtures, and local experiments only;
- new durable stores require demand evidence, a named owner, store-conformance parity, operations/security documentation, migration and compatibility planning, and release validation;
- GitHub Actions remains the only first-class CI surface;
- non-GitHub CI docs or templates require the trigger record in the adoption-readiness report to pass;
- no package split, hosted service, new backend, CI template family, or architecture expansion is authorized by this ADR.

## Consequences

This keeps maintenance cost aligned with observed adoption. Users get a clearer, safer support boundary: the existing package, Redis adapter, memory store, and GitHub workflow examples are maintained; unrequested platforms and stores are not implied. The cost is slower response for early non-GitHub or non-Redis adopters until they provide enough evidence and owner commitment to justify support.

## Revisit triggers

Revisit only when the adoption-readiness report can cite one of these evidence classes:

- repeated independent user requests for the same backend, package split, or CI provider;
- an approved adopter with reproducible constraints, logs or workflows, and maintainer-approved priority;
- install-size, dependency, security, or support data showing the current one-package/Redis/GitHub shape blocks adoption;
- a named maintainer or domain owner who commits to validation, security review, documentation, and long-term maintenance.
