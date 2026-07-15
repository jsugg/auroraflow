# <Area> architecture

<!--
Copy to docs/architecture/<name>.md and replace every placeholder.
Reference implementation: docs/architecture/data-layer.md.

These are information requirements, not a layout to reproduce. Cover each item somewhere the
reader can find it; merge, reorder, or rename sections when that serves the material better.
Delete sections that genuinely do not apply, and say why in Scope rather than leaving a stub.
-->

## Context

Why this area exists, the problem it solves, and the decision that authorized it (`AUR-DEC-*`). State whether the behavior described is implemented or planned — see the documentation rules in [development guide](../development.md).

## Scope

What this document owns, and what it explicitly does not. Name the neighboring documents that own the rest so a reader who is in the wrong place can leave quickly.

## Components and data flow

The moving parts and how data moves between them. A Mermaid diagram is welcome, but the prose must carry the explanation on its own — a reader who cannot render the diagram must not lose information.

## Invariants

What must always hold. These are the statements a reviewer checks a change against, so write them as assertions ("promotion writes require a review record"), not as aspirations.

## Trust boundaries

Where control passes between the package, the consumer, and any operator-owned infrastructure. Name who owns what on each side; AuroraFlow is library-first and consumers own execution, CI, Redis, observability backends, retention, credentials, and incident response.

## Failure modes

How this area fails, what the reader observes when it does, and which failures are contained versus escalating. Include the safety defaults that keep a failure from becoming a mutation.

## Related decisions

The ADRs and `AUR-DEC-*` entries that govern this area, and the revisit triggers they carry.
