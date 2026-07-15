# Link check effectiveness fixture

This document is intentionally defective. `documentationLinks.contract.spec.ts` runs `scripts/docs-link-check.mjs` against it and asserts every rule below is reported, so the documentation checks cannot silently stop detecting anything. It is outside the checker's default scope and is not part of the published documentation set.

[missing target](./no-such-document.md)

[bad anchor](#no-such-heading)

![](./no-alt-text.png)

See [here](./link-check-violations.md) for non-descriptive link text.

### Skipped heading level
