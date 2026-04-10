# AuroraFlow Examples

This directory contains runnable examples that demonstrate framework patterns and usage.

## Goals
- Show minimal, production-style patterns that are easy to copy.
- Keep examples deterministic so they can run in CI reliably.
- Provide a learning path from simple POM usage to more advanced patterns.

## Quickstart
- Open the quickstart fixture-based example in `examples/quickstart/`.
- Run only examples locally:

```bash
npm run test:examples
```

## Full Validation
Run the baseline quality and smoke gates:

```bash
npm run verify
npm run test:smoke
npm run security:check
```

## Notes
- Examples are validated in CI by `.github/workflows/examples.yml`.
- Example tests are organized under `tests/suites/e2e/examples/`.
